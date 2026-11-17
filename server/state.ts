import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import {
  emptyInterior,
  firstLeaf,
  regions,
  remapCompartment,
} from "../shared/compartments.js";
import lockfile from "proper-lockfile";
import { jsonWrite } from "../scripts/lib/store.js";
import {
  items,
  planSurface,
  planFloor,
  followAttachments,
  storageGrid,
} from "../shared/spatial.js";
import {
  commandSchema,
  eventSchema,
  validateTemplate,
  furnitureKinds,
  deviceKinds,
  structuralKinds,
  type Dashboard,
  type HomeTemplate,
  type Receipt,
  type Observation,
} from "../shared/domain.js";
import type { CyberGraph } from "../shared/cyber.js";
import { synthesizeDefaultCyberGraph } from "../shared/cyber-arch.js";

export class DomainError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
interface DiskState extends Dashboard {
  receipts: Record<string, { hash: string; receipt: Receipt }>;
  eventReceipts: Record<string, { hash: string; at: string }>;
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const windowMs = 24 * 60 * 60 * 1000;
const cloneEditableCyber = (home: HomeTemplate, asOf?: string): CyberGraph => {
  const base =
    home.cyber ??
    synthesizeDefaultCyberGraph(home, asOf ?? new Date().toISOString());
  return {
    ...base,
    asOf: asOf ?? (base.asOf || new Date().toISOString()),
    clouds: [...base.clouds],
    nodes: [...base.nodes],
    edges: [...base.edges],
    ...(base.zones ? { zones: [...base.zones] } : {}),
    ...(base.categories ? { categories: { ...base.categories } } : {}),
    ...(base.topologies ? { topologies: { ...base.topologies } } : {}),
  };
};

export class StateStore extends EventEmitter {
  readonly directory: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly root: string,
    readonly defaultTemplate: HomeTemplate,
  ) {
    super();
    this.directory = join(root, "data/dashboard");
  }
  private async locked<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const release = await lockfile.lock(this.directory, {
        stale: 30000,
        retries: { retries: 10, minTimeout: 50, maxTimeout: 100 },
      });
      try {
        return await work();
      } finally {
        await release();
      }
    });
    this.queue = next.catch(() => {});
    return next;
  }
  private async read(): Promise<DiskState> {
    try {
      const state = JSON.parse(
        await readFile(join(this.directory, "state.json"), "utf8"),
      ) as DiskState;
      if (
        state.schemaVersion !== 1 ||
        !state.receipts ||
        !state.eventReceipts ||
        !Number.isInteger(state.revision)
      )
        throw new Error(
          "Unsupported dashboard journal. Restore a backup; do not reset automatically.",
        );
      validateTemplate(state.home);
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      let initial = this.defaultTemplate;
      try {
        initial = validateTemplate(
          JSON.parse(
            await readFile(join(this.directory, "initial-home.json"), "utf8"),
          ),
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      const state: DiskState = {
        schemaVersion: 1,
        revision: 0,
        home: validateTemplate(initial),
        observations: [],
        incidents: [],
        unmapped: [],
        activity: [],
        receipts: {},
        eventReceipts: {},
      };
      await jsonWrite(join(this.directory, "state.json"), state);
      return state;
    }
  }
  private publicState(state: DiskState): Dashboard {
    const {
      receipts: _receipts,
      eventReceipts: _events,
      ...publicState
    } = state;
    return publicState;
  }
  async snapshot() {
    return this.locked(async () => this.publicState(await this.read()));
  }
  private async commit(state: DiskState) {
    await jsonWrite(join(this.directory, "state.json"), state);
    this.emit("change", this.publicState(state));
  }
  async execute(input: unknown, actor = "browser"): Promise<Receipt> {
    const command = commandSchema.parse(input);
    return this.locked(async () => {
      const state = await this.read();
      const digest = hash(command);
      const existing = state.receipts[command.operationId];
      if (existing) {
        if (existing.hash !== digest)
          throw new DomainError(
            "Operation ID already belongs to different input.",
            409,
          );
        return existing.receipt;
      }
      const age = Date.now() - Date.parse(command.issuedAt);
      if (age > windowMs || age < -60000)
        throw new DomainError(
          "Command expired or its clock is in the future. Inspect current state before creating a new command.",
          409,
        );
      if (command.expectedRevision !== state.revision)
        throw new DomainError(
          "State changed. Refresh and review the change before retrying.",
          409,
        );
      const action = command.action;
      const previousHome = structuredClone(state.home);
      const explicitlyMoved = new Set<string>();
      const result: Record<string, unknown> = {};
      const requireEntity = (id: string) => {
        const entity = state.home.entities.find((v) => v.id === id);
        if (!entity) throw new DomainError("Unknown entity.");
        return entity;
      };
      const requireStock = (id: string) => {
        const stock = state.home.stocks.find((v) => v.id === id);
        if (!stock) throw new DomainError("Unknown stock zone.");
        return stock;
      };
      const storeItem = (
        itemId: string,
        containerId: string,
        compartmentId?: string,
        slot?: number,
      ) => {
        const item = items(state.home).find((i) => i.id === itemId);
        const container = requireEntity(containerId);
        if (!item) throw new DomainError("Unknown item.");
        const config = storageGrid(state.home, containerId);
        const used = new Set(
          items(state.home)
            .filter(
              (i) =>
                i.id !== itemId &&
                i.attachment?.kind === "storage" &&
                i.attachment.parentId === containerId,
            )
            .map((i) => i.attachment!.slot),
        );
        const capacity = config.interior ? 4096 : config.columns * config.rows;
        const free = Array.from({ length: capacity }, (_, i) => i).find(
          (i) => !used.has(i),
        );
        if (slot === undefined && free === undefined)
          throw new DomainError("收纳格位已满，请编辑内部空间后再放入。");
        item.attachment = {
          parentId: containerId,
          kind: "storage",
          slot: slot ?? free,
          ...(config.interior
            ? { compartmentId: compartmentId ?? firstLeaf(config.interior) }
            : compartmentId
              ? { compartmentId }
              : {}),
        };
        item.locationId = container.locationId;
        item.position = [...container.position];
        if ("placementConfirmed" in item) item.placementConfirmed = true;
        explicitlyMoved.add(item.id);
      };
      switch (action.type) {
        case "cyber.replace":
          if (
            state.home.cyber?.source === action.graph.source &&
            Date.parse(action.graph.asOf) < Date.parse(state.home.cyber.asOf)
          )
            throw new DomainError(
              "Older topology cannot replace the current snapshot.",
              409,
            );
          state.home.cyber = action.graph;
          result.source = action.graph.source;
          break;
        case "cyber.node.upsert": {
          const next = cloneEditableCyber(state.home, action.asOf);
          const replaceId = action.previousId ?? action.node.id;
          if (action.previousId && action.previousId !== action.node.id) {
            if (!next.nodes.some((n) => n.id === action.previousId)) {
              throw new DomainError("Unknown cyber node to rename.");
            }
            next.edges = next.edges.map((e) => ({
              ...e,
              source:
                e.source === action.previousId ? action.node.id : e.source,
              target:
                e.target === action.previousId ? action.node.id : e.target,
            }));
          }
          const idx = next.nodes.findIndex((n) => n.id === replaceId);
          if (idx >= 0) next.nodes[idx] = action.node;
          else next.nodes.push(action.node);
          state.home.cyber = next;
          result.nodeId = action.node.id;
          break;
        }
        case "cyber.node.delete": {
          const next = cloneEditableCyber(state.home, action.asOf);
          if (!next.nodes.some((n) => n.id === action.id)) {
            throw new DomainError("Unknown cyber node.");
          }
          next.nodes = next.nodes.filter((n) => n.id !== action.id);
          next.edges = next.edges.filter(
            (e) => e.source !== action.id && e.target !== action.id,
          );
          state.home.cyber = next;
          result.nodeId = action.id;
          break;
        }
        case "cyber.edge.upsert": {
          const next = cloneEditableCyber(state.home, action.asOf);
          const replaceId = action.previousId ?? action.edge.id;
          if (
            action.previousId &&
            action.previousId !== action.edge.id &&
            !next.edges.some((e) => e.id === action.previousId)
          ) {
            throw new DomainError("Unknown cyber edge to rename.");
          }
          const idx = next.edges.findIndex((e) => e.id === replaceId);
          if (idx >= 0) next.edges[idx] = action.edge;
          else next.edges.push(action.edge);
          state.home.cyber = next;
          result.edgeId = action.edge.id;
          break;
        }
        case "cyber.edge.delete": {
          const next = cloneEditableCyber(state.home, action.asOf);
          if (!next.edges.some((e) => e.id === action.id)) {
            throw new DomainError("Unknown cyber edge.");
          }
          next.edges = next.edges.filter((e) => e.id !== action.id);
          state.home.cyber = next;
          result.edgeId = action.id;
          break;
        }
        case "cyber.zone.upsert": {
          const next = cloneEditableCyber(state.home, action.asOf);
          const zones = [...(next.zones ?? [])];
          const replaceId = action.previousId ?? action.zone.id;
          if (action.previousId && action.previousId !== action.zone.id) {
            if (!zones.some((z) => z.id === action.previousId)) {
              throw new DomainError("Unknown cyber zone to rename.");
            }
            next.nodes = next.nodes.map((n) =>
              n.zone === action.previousId ? { ...n, zone: action.zone.id } : n,
            );
            state.home.services = state.home.services.map((s) =>
              s.zone === action.previousId ? { ...s, zone: action.zone.id } : s,
            );
          }
          const idx = zones.findIndex((z) => z.id === replaceId);
          if (idx >= 0) zones[idx] = action.zone;
          else zones.push(action.zone);
          next.zones = zones;
          state.home.cyber = next;
          result.zoneId = action.zone.id;
          break;
        }
        case "cyber.zone.delete": {
          const next = cloneEditableCyber(state.home, action.asOf);
          const zones = next.zones ?? [];
          if (!zones.some((z) => z.id === action.id)) {
            throw new DomainError("Unknown cyber zone.");
          }
          next.zones = zones.filter((z) => z.id !== action.id);
          next.nodes = next.nodes.map((n) =>
            n.zone === action.id ? { ...n, zone: undefined } : n,
          );
          state.home.services = state.home.services.map((s) =>
            s.zone === action.id ? { ...s, zone: undefined } : s,
          );
          state.home.cyber = next;
          result.zoneId = action.id;
          break;
        }
        case "cyber.taxonomy.upsert": {
          const next = cloneEditableCyber(state.home, action.asOf);
          if (
            action.replaceCategories ||
            action.categories ||
            action.deleteCategories?.length
          ) {
            const cats = action.replaceCategories
              ? { ...(action.categories ?? {}) }
              : { ...(next.categories ?? {}), ...(action.categories ?? {}) };
            for (const key of action.deleteCategories ?? []) {
              delete cats[key];
            }
            next.categories = Object.keys(cats).length > 0 ? cats : undefined;
          }
          if (
            action.replaceTopologies ||
            action.topologies ||
            action.deleteTopologies?.length
          ) {
            const topos = action.replaceTopologies
              ? { ...(action.topologies ?? {}) }
              : { ...(next.topologies ?? {}), ...(action.topologies ?? {}) };
            for (const key of action.deleteTopologies ?? []) {
              delete topos[key];
            }
            next.topologies = Object.keys(topos).length > 0 ? topos : undefined;
          }
          state.home.cyber = next;
          result.source = next.source;
          break;
        }
        case "item.record": {
          if (
            action.item.assetId !== action.asset.id ||
            state.home.assets.some((a) => a.id === action.asset.id)
          )
            throw new DomainError("Use a new matching appearance ID.");
          state.home.assets.push(action.asset);
          if ("quantity" in action.item) state.home.stocks.push(action.item);
          else state.home.entities.push(action.item);
          if (action.containerId)
            storeItem(action.item.id, action.containerId, action.compartmentId);
          else if (action.compartmentId)
            throw new DomainError("A compartment needs a container.");
          result.itemId = action.item.id;
          break;
        }
        case "item.photos": {
          const item = items(state.home).find((i) => i.id === action.itemId);
          if (!item) throw new DomainError("Unknown item.");
          item.photos = action.photos;
          result.itemId = item.id;
          break;
        }
        case "object.mount": {
          const entity = requireEntity(action.entityId);
          requireEntity(action.parentId);
          entity.attachment = { parentId: action.parentId, kind: "mount" };
          explicitlyMoved.add(entity.id);
          result.entityId = entity.id;
          break;
        }
        case "storage.configure": {
          const before = storageGrid(state.home, action.storage.entityId);
          if (action.storage.interior) {
            regions(action.storage.interior);
            for (const item of items(state.home)) {
              if (
                item.attachment?.kind === "storage" &&
                item.attachment.parentId === action.storage.entityId
              )
                item.attachment.compartmentId = remapCompartment(
                  before.interior ?? emptyInterior(),
                  action.storage.interior,
                  item.attachment.compartmentId,
                );
            }
          } else if (before.interior)
            throw new DomainError(
              "Keep the cabinet interior; merge regions to simplify it.",
            );
          state.home.storage = [
            ...(state.home.storage ?? []).filter(
              (s) => s.entityId !== action.storage.entityId,
            ),
            action.storage,
          ];
          result.entityId = action.storage.entityId;
          break;
        }
        case "storage.place": {
          storeItem(
            action.itemId,
            action.containerId,
            action.compartmentId,
            action.slot,
          );
          result.itemId = action.itemId;
          break;
        }
        case "surface.place": {
          const plan = planSurface(
            state.home,
            action.itemId,
            action.supportId,
            action.preferred,
            action.quarterTurn,
          );
          const item = items(state.home).find((i) => i.id === action.itemId)!;
          item.position = plan.position;
          item.rotation = plan.rotation;
          item.locationId = requireEntity(action.supportId).locationId;
          item.attachment = { parentId: action.supportId, kind: "surface" };
          if ("placementConfirmed" in item) item.placementConfirmed = true;
          explicitlyMoved.add(item.id);
          Object.assign(result, { itemId: item.id, ...plan });
          break;
        }
        case "item.release": {
          const plan = planFloor(state.home, action.itemId, action.locationId);
          const item = items(state.home).find((i) => i.id === action.itemId)!;
          item.position = plan.position;
          item.rotation = plan.rotation;
          item.locationId = action.locationId;
          delete item.attachment;
          if ("placementConfirmed" in item) item.placementConfirmed = true;
          explicitlyMoved.add(item.id);
          result.itemId = item.id;
          break;
        }
        case "object.model": {
          const entity = requireEntity(action.entityId);
          if (state.home.assets.some((a) => a.id === action.asset.id))
            throw new DomainError(
              "Use a new asset ID for the model association.",
            );
          state.home.assets.push(action.asset);
          entity.assetId = action.asset.id;
          result.entityId = entity.id;
          break;
        }
        case "layout.commit": {
          const previousHome = structuredClone(state.home);
          if (action.rooms) state.home.rooms = action.rooms;
          const edited = new Set<string>();
          for (const { entity, asset } of action.additions) {
            if (
              !["object", "device", "host"].includes(entity.category) ||
              entity.scope !== "home" ||
              entity.lifecycle !== "active" ||
              !(
                [
                  ...furnitureKinds,
                  ...deviceKinds,
                  ...structuralKinds,
                  "computer",
                  "server",
                  "plug",
                  "box",
                  "plant",
                ] as readonly string[]
              ).includes(asset.kind) ||
              entity.assetId !== asset.id
            )
              throw new DomainError(
                "Layout additions must be independent active home objects or devices.",
              );
            if (
              state.home.entities.some((e) => e.id === entity.id) ||
              state.home.assets.some((a) => a.id === asset.id)
            )
              throw new DomainError(
                "Layout addition already exists; use a new object ID.",
              );
            if (
              entity.placementConfirmed &&
              state.home.rooms.find((r) => r.id === entity.locationId)?.kind !==
                "room"
            )
              throw new DomainError(
                "Logical collection placements cannot be confirmed as physical.",
              );
            state.home.entities.push(entity);
            state.home.assets.push(asset);
          }
          for (const placement of action.placements) {
            const key = `${placement.kind}:${placement.id}`;
            if (edited.has(key))
              throw new DomainError("Duplicate layout placement.");
            edited.add(key);
            const item =
              placement.kind === "entity"
                ? requireEntity(placement.id)
                : requireStock(placement.id);
            if ("lifecycle" in item && item.lifecycle === "retired")
              throw new DomainError("Retired entities cannot be moved.");
            if (placement.asset) {
              if (state.home.assets.some((a) => a.id === placement.asset!.id))
                throw new DomainError(
                  "Dimension changes require an independent new asset ID.",
                );
              state.home.assets.push(placement.asset);
              item.assetId = placement.asset.id;
            }
            item.locationId = placement.locationId;
            item.position = placement.position;
            item.rotation = placement.rotation;
            delete item.attachment;
            explicitlyMoved.add(item.id);
            if ("placementConfirmed" in item)
              item.placementConfirmed =
                placement.placementConfirmed &&
                state.home.rooms.find((r) => r.id === item.locationId)?.kind ===
                  "room";
          }
          followAttachments(state.home, previousHome, explicitlyMoved);
          state.home = validateTemplate(state.home);
          const backups = join(this.directory, "backups");
          await mkdir(backups, { recursive: true, mode: 0o700 });
          await jsonWrite(
            join(backups, `before-layout-v${state.revision}.json`),
            previousHome,
          );
          Object.assign(result, {
            added: action.additions.length,
            placed: action.placements.length,
            rooms: state.home.rooms.length,
          });
          break;
        }
        case "electrical.upsert": {
          const circuits = state.home.electricalCircuits ?? [];
          state.home.electricalCircuits = [
            ...circuits.filter((c) => c.id !== action.circuit.id),
            action.circuit,
          ];
          state.home = validateTemplate(state.home);
          result.circuitId = action.circuit.id;
          break;
        }
        case "hotspot.upsert": {
          const nextHotspots = state.home.hotspots ?? [];
          const normalized = structuredClone(action.hotspot);
          const toAdminUpload = (url: string) =>
            url.replace(/^\/api\/guest\/uploads\//, "/api/uploads/");
          if (normalized.effect.kind === "envelope" && normalized.effect.photo)
            normalized.effect.photo = toAdminUpload(normalized.effect.photo);
          if (normalized.effect.kind === "spotlight" && normalized.effect.photo)
            normalized.effect.photo = toAdminUpload(normalized.effect.photo);
          if (normalized.effect.kind === "album") {
            normalized.effect.items = normalized.effect.items.map((item) => ({
              ...item,
              photo: toAdminUpload(item.photo),
            }));
          }
          const idx = nextHotspots.findIndex((h) => h.id === normalized.id);
          if (idx >= 0) {
            state.home.hotspots = nextHotspots.map((h, i) =>
              i === idx ? normalized : h,
            );
          } else {
            state.home.hotspots = [...nextHotspots, normalized];
          }
          result.hotspotId = normalized.id;
          break;
        }
        case "hotspot.delete": {
          const current = state.home.hotspots ?? [];
          if (!current.some((h) => h.id === action.hotspotId))
            throw new DomainError("Unknown hotspot.");
          state.home.hotspots = current.filter(
            (h) => h.id !== action.hotspotId,
          );
          result.hotspotId = action.hotspotId;
          break;
        }
        case "entity.guest": {
          const entity = requireEntity(action.entityId);
          entity.guest = action.guest;
          result.entityId = entity.id;
          break;
        }
        case "stock.adjust": {
          const stock = requireStock(action.stockId);
          const quantity = stock.quantity + action.delta;
          if (quantity < 0 || quantity > 100000)
            throw new DomainError("Quantity must remain between 0 and 100000.");
          result.previous = stock.quantity;
          stock.quantity = quantity;
          result.quantity = quantity;
          result.stockId = stock.id;
          break;
        }
        case "stock.transfer": {
          const from = requireStock(action.fromId),
            to = requireStock(action.toId);
          if (from.id === to.id || from.sku !== to.sku || from.unit !== to.unit)
            throw new DomainError(
              "Transfer requires distinct zones with the same SKU and unit.",
            );
          if (
            from.quantity < action.quantity ||
            to.quantity + action.quantity > 100000
          )
            throw new DomainError(
              "Insufficient stock or target limit exceeded.",
            );
          from.quantity -= action.quantity;
          to.quantity += action.quantity;
          Object.assign(result, { from: from.quantity, to: to.quantity });
          break;
        }
        case "stock.create":
          state.home.stocks.push(action.stock);
          result.stockId = action.stock.id;
          break;
        case "entity.place": {
          const entity = requireEntity(action.entityId);
          if (entity.lifecycle === "retired")
            throw new DomainError(
              "Retired entities cannot be placed as active equipment.",
            );
          Object.assign(entity, {
            locationId: action.locationId,
            position: action.position,
            rotation: action.rotation,
            placementConfirmed:
              state.home.rooms.find((r) => r.id === action.locationId)?.kind ===
              "room",
          });
          delete entity.attachment;
          explicitlyMoved.add(entity.id);
          result.entityId = entity.id;
          break;
        }
        case "entity.describe": {
          const entity = requireEntity(action.entityId);
          if (action.name !== undefined) entity.name = action.name;
          if (action.description !== undefined)
            entity.description = action.description;
          if (action.visibility !== undefined)
            entity.visibility = action.visibility;
          result.entityId = entity.id;
          break;
        }
        case "entity.note":
          requireEntity(action.entityId).notes = action.notes;
          result.entityId = action.entityId;
          break;
        case "entity.create":
          state.home.entities.push(action.entity);
          result.entityId = action.entity.id;
          break;
        case "object.capture":
          state.home.assets.push(action.asset);
          state.home.entities.push(action.entity);
          if (action.supportId) {
            const plan = planSurface(
              state.home,
              action.entity.id,
              action.supportId,
            );
            action.entity.position = plan.position;
            action.entity.rotation = plan.rotation;
            action.entity.locationId = requireEntity(
              action.supportId,
            ).locationId;
            action.entity.attachment = {
              parentId: action.supportId,
              kind: "surface",
            };
            action.entity.placementConfirmed = true;
          }
          result.entityId = action.entity.id;
          break;
        case "stock.asset":
          state.home.assets = [
            ...state.home.assets.filter((a) => a.id !== action.asset.id),
            action.asset,
          ];
          requireStock(action.stockId).assetId = action.asset.id;
          result.stockId = action.stockId;
          break;
        case "entity.asset":
          requireEntity(action.entityId).assetId = action.assetId;
          result.entityId = action.entityId;
          break;
        case "asset.upsert":
          state.home.assets = [
            ...state.home.assets.filter((v) => v.id !== action.asset.id),
            action.asset,
          ];
          result.assetId = action.asset.id;
          break;
        case "room.update": {
          if (!state.home.rooms.some((r) => r.id === action.room.id))
            throw new DomainError("Unknown room.");
          state.home.rooms = state.home.rooms.map((v) =>
            v.id === action.room.id ? action.room : v,
          );
          result.roomId = action.room.id;
          break;
        }
        case "service.upsert":
          state.home.services = [
            ...state.home.services.filter((v) => v.id !== action.service.id),
            action.service,
          ];
          result.serviceId = action.service.id;
          break;
        case "incident.ack": {
          const incident = state.incidents.find(
            (v) => v.id === action.incidentId,
          );
          if (!incident || incident.state === "resolved")
            throw new DomainError("Incident missing or already resolved.");
          incident.state = "acknowledged";
          result.incidentId = incident.id;
          break;
        }
        case "template.import": {
          const backups = join(this.directory, "backups");
          await mkdir(backups, { recursive: true, mode: 0o700 });
          await jsonWrite(
            join(backups, `before-import-v${state.revision}.json`),
            state.home,
          );
          state.home = validateTemplate(action.template);
          state.observations = [];
          state.incidents = [];
          state.unmapped = [];
          result.templateId = state.home.id;
          break;
        }
      }
      if (action.type !== "layout.commit" && action.type !== "template.import")
        followAttachments(state.home, previousHome, explicitlyMoved);
      state.home = validateTemplate(state.home);
      state.revision++;
      const receipt: Receipt = {
        operationId: command.operationId,
        revision: state.revision,
        at: new Date().toISOString(),
        action: action.type,
        actor,
        result,
      };
      state.receipts = Object.fromEntries(
        Object.entries(state.receipts).filter(
          ([, v]) => Date.now() - Date.parse(v.receipt.at) <= windowMs,
        ),
      );
      state.receipts[command.operationId] = { hash: digest, receipt };
      state.activity = [...state.activity.slice(-199), receipt];
      await this.commit(state);
      return receipt;
    });
  }
  async ingest(input: unknown, demo = false) {
    const event = eventSchema.parse(input);
    return this.locked(async () => {
      const state = await this.read();
      const key = `${demo ? "demo" : "live"}:${event.source}:${event.eventId}`;
      const digest = hash(event);
      if (state.eventReceipts[key]) {
        if (state.eventReceipts[key].hash !== digest)
          throw new DomainError("Event ID reused with different content.", 409);
        return { duplicate: true, revision: state.revision };
      }
      if (
        Date.parse(event.observedAt) > Date.now() + 60000 ||
        Date.now() - Date.parse(event.observedAt) > windowMs
      )
        throw new DomainError(
          "Event timestamp is outside the 24-hour ingestion window.",
        );
      const observation: Observation = {
        ...event,
        source: demo ? `demo.${event.source}` : event.source,
        receivedAt: new Date().toISOString(),
        demo,
      };
      const subject =
        state.home.entities.find((v) => v.id === event.subjectId) ??
        state.home.services.find((v) => v.id === event.subjectId);
      const previous = state.observations.find(
        (v) =>
          v.source === observation.source &&
          v.subjectId === event.subjectId &&
          v.condition === event.condition,
      );
      let disposition = "applied";
      if (
        !subject ||
        ("lifecycle" in subject && subject.lifecycle === "retired")
      ) {
        state.unmapped = [...state.unmapped.slice(-99), observation];
        disposition = "unmapped";
      } else if (
        previous &&
        Date.parse(previous.observedAt) >= Date.parse(event.observedAt)
      ) {
        disposition = "older";
      } else {
        state.observations = [
          ...state.observations.filter(
            (v) =>
              !(
                v.source === observation.source &&
                v.subjectId === event.subjectId &&
                v.condition === event.condition
              ),
          ),
          observation,
        ].slice(-2000);
        const id =
          "incident-" +
          hash([observation.source, event.subjectId, event.condition]).slice(
            0,
            20,
          );
        const incident = state.incidents.find((v) => v.id === id);
        if (event.status === "open") {
          if (incident)
            Object.assign(incident, {
              message: event.message,
              severity: event.severity,
              updatedAt: event.observedAt,
              count: incident.count + 1,
              state: incident.state === "resolved" ? "open" : incident.state,
            });
          else
            state.incidents.push({
              id,
              source: observation.source,
              subjectId: event.subjectId,
              condition: event.condition,
              severity: event.severity,
              message: event.message,
              state: "open",
              firstSeen: event.observedAt,
              updatedAt: event.observedAt,
              count: 1,
              demo,
            });
        } else if (incident) {
          incident.state = "resolved";
          incident.updatedAt = event.observedAt;
        }
      }
      state.eventReceipts = Object.fromEntries(
        Object.entries(state.eventReceipts).filter(
          ([, v]) => Date.now() - Date.parse(v.at) <= windowMs,
        ),
      );
      state.eventReceipts[key] = { hash: digest, at: new Date().toISOString() };
      state.revision++;
      await this.commit(state);
      return { duplicate: false, disposition, revision: state.revision };
    });
  }
}
