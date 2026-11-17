import { pointInFootprint, deviceKinds } from "./domain.js";
import type { Entity, HomeTemplate, SceneAsset, Stock } from "./domain.js";
import { regions, leaves } from "./compartments.js";

export type TaskMode = "browse" | "devices" | "inventory";
export type SpatialItem = Entity | Stock;
export type Point2 = [number, number];
export const storageKinds = new Set([
  "wardrobe",
  "shelf",
  "metal-shelf",
  "cabinet",
  "drawer-cabinet",
  "bedside-cabinet",
  "display-cabinet",
  "glass-cabinet",
  "fridge",
  "mini-fridge",
  "sink",
  "kitchen-counter",
  "round-storage-table",
  "box",
]);
export const surfaceKinds = new Set([
  "table",
  "cabinet",
  "drawer-cabinet",
  "bedside-cabinet",
  "round-storage-table",
  "bench",
]);
export type SpatialAssetLike = Pick<
  SceneAsset,
  "id" | "kind" | "width" | "height" | "depth" | "front"
>;
export type SpatialItemLike = {
  id: string;
  assetId: string;
  attachment?: Entity["attachment"];
};
export type SpatialHomeLike = {
  entities: SpatialItemLike[];
  stocks?: Stock[];
  assets: SpatialAssetLike[];
  storage?: HomeTemplate["storage"];
};

export const items = (
  home: Pick<HomeTemplate, "entities"> & { stocks?: Stock[] },
): SpatialItem[] => [...home.entities, ...(home.stocks ?? [])];
export const assetFor = <A extends SpatialAssetLike>(
  home: { assets: A[] },
  item: { assetId: string },
): A => home.assets.find((a) => a.id === item.assetId)!;
export const isStorage = (
  home: { assets: SpatialAssetLike[]; storage?: HomeTemplate["storage"] },
  entity: { id: string; assetId: string },
) =>
  storageKinds.has(assetFor(home, entity)?.kind) ||
  Boolean(home.storage?.some((s) => s.entityId === entity.id));
export const isSurface = (home: HomeTemplate, entity: Entity) =>
  surfaceKinds.has(assetFor(home, entity)?.kind);
export const storageGrid = (home: HomeTemplate, id: string) =>
  home.storage?.find((s) => s.entityId === id) ?? {
    entityId: id,
    columns: 4,
    rows: 4,
  };
export function eligible(
  home: HomeTemplate,
  item: SpatialItem,
  task: TaskMode,
) {
  if (
    "lifecycle" in item &&
    (item.lifecycle !== "active" || item.visibility === "editing")
  )
    return false;
  if (task === "devices")
    return (
      "category" in item &&
      (["host", "device"].includes(item.category) ||
        [
          ...deviceKinds,
          "screen",
          "wall-display",
          "keyboard",
          "mouse",
          "microphone",
          "headphones",
          "plug",
        ].includes(assetFor(home, item)?.kind as (typeof deviceKinds)[number]))
    );
  if (task === "inventory")
    return (
      "quantity" in item ||
      isStorage(home, item) ||
      item.attachment?.kind === "storage"
    );
  return true;
}
export function frontAngle(asset: Pick<SceneAsset, "kind" | "front">) {
  return (
    asset.front ??
    (["chair", "gaming-chair", "armchair"].includes(asset.kind) ? Math.PI : 0)
  );
}

export function footprint(
  home: HomeTemplate,
  item: SpatialItem,
): [number, number, number] {
  const a = assetFor(home, item);
  if (!("quantity" in item)) return [a.width, a.depth, a.height];
  const count = Math.min(item.quantity, 24),
    columns = Math.max(1, Math.min(count, 6)),
    rows = Math.max(1, Math.ceil(count / 6));
  return [
    Math.max(1, columns * (a.width + 0.08) + 0.15),
    Math.max(0.8, rows * (a.depth + 0.08) + 0.15),
    a.height + 0.05,
  ];
}
export function rotate([x, z]: Point2, angle: number): Point2 {
  return [
    x * Math.cos(angle) + z * Math.sin(angle),
    -x * Math.sin(angle) + z * Math.cos(angle),
  ];
}
export function corners(
  center: Point2,
  width: number,
  depth: number,
  angle: number,
): Point2[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, z]) => {
    const p = rotate([(x * width) / 2, (z * depth) / 2], angle);
    return [p[0] + center[0], p[1] + center[1]];
  });
}
export function overlaps(a: Point2[], b: Point2[], gap = 0.015) {
  for (const polygon of [a, b])
    for (let i = 0; i < 4; i++) {
      const p = polygon[i],
        q = polygon[(i + 1) % 4],
        length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const axis = [-(q[1] - p[1]) / length, (q[0] - p[0]) / length];
      const aa = a.map((v) => v[0] * axis[0] + v[1] * axis[1]),
        bb = b.map((v) => v[0] * axis[0] + v[1] * axis[1]);
      if (
        Math.max(...aa) + gap <= Math.min(...bb) ||
        Math.max(...bb) + gap <= Math.min(...aa)
      )
        return false;
    }
  return true;
}
function physicallyActive(home: HomeTemplate, item: SpatialItem) {
  return (
    home.rooms.find((r) => r.id === item.locationId)?.kind === "room" &&
    (!("scope" in item) ||
      (item.scope === "home" && item.lifecycle === "active"))
  );
}
export function validateSpatialRelations(home: HomeTemplate) {
  const all = items(home),
    byId = new Map(all.map((i) => [i.id, i]));
  const configurations = home.storage ?? [];
  if (
    new Set(configurations.map((c) => c.entityId)).size !==
    configurations.length
  )
    throw new Error("Duplicate storage configuration.");
  for (const config of configurations) {
    if (config.interior) regions(config.interior);
    const parent = home.entities.find((e) => e.id === config.entityId);
    if (!parent || !physicallyActive(home, parent))
      throw new Error("Storage needs an active physical home container.");
  }
  const occupied = new Set<string>();
  for (const item of all) {
    if (!item.attachment) continue;
    const { parentId, kind, slot, compartmentId } = item.attachment;
    if (compartmentId && kind !== "storage")
      throw new Error("Only stored items can have a compartment.");
    const parent = home.entities.find((e) => e.id === parentId);
    if (
      !parent ||
      !physicallyActive(home, parent) ||
      !physicallyActive(home, item) ||
      item.locationId !== parent.locationId
    )
      throw new Error(
        "Attachment requires active physical objects in the same room.",
      );
    const seen = new Set([item.id]);
    let ancestor: SpatialItem | undefined = parent;
    while (ancestor) {
      if (seen.has(ancestor.id))
        throw new Error("Containment cycle is not allowed.");
      seen.add(ancestor.id);
      ancestor = ancestor.attachment
        ? byId.get(ancestor.attachment.parentId)
        : undefined;
    }
    if (kind === "mount") {
      if (!("category" in item) || slot !== undefined)
        throw new Error("Mounts require entities without storage slots.");
      let mountedAncestor: SpatialItem | undefined = parent;
      while (mountedAncestor) {
        if (mountedAncestor.attachment?.kind === "storage")
          throw new Error("Cannot mount to stored objects.");
        mountedAncestor = mountedAncestor.attachment
          ? byId.get(mountedAncestor.attachment.parentId)
          : undefined;
      }
    } else if (kind === "storage") {
      const grid = storageGrid(home, parentId),
        key = `${parentId}:${slot}`;
      if (
        !isStorage(home, parent) ||
        slot === undefined ||
        slot >= (grid.interior ? 4096 : grid.columns * grid.rows) ||
        (compartmentId !== undefined &&
          (!grid.interior ||
            !leaves(grid.interior).some((r) => r.part.id === compartmentId)))
      )
        throw new Error("Invalid storage slot.");
      if (occupied.has(key)) throw new Error("Storage slot already occupied.");
      occupied.add(key);
    } else {
      if (
        slot !== undefined ||
        !isSurface(home, parent) ||
        parent.attachment?.kind === "storage"
      )
        throw new Error("Invalid supporting surface.");
      const sa = assetFor(home, parent),
        [w, d, h] = footprint(home, item);
      const polygon = corners(
        [item.position[0], item.position[2]],
        w,
        d,
        item.rotation ?? 0,
      );
      if (
        Math.abs(item.position[1] - parent.position[1] - sa.height) > 0.003 ||
        polygon.some((p) => {
          const local = rotate(
            [p[0] - parent.position[0], p[1] - parent.position[2]],
            -parent.rotation,
          );
          return (
            Math.abs(local[0]) > sa.width / 2 - 0.014 ||
            Math.abs(local[1]) > sa.depth / 2 - 0.014 ||
            (sa.kind === "round-storage-table" &&
              (local[0] / (sa.width / 2 - 0.014)) ** 2 +
                (local[1] / (sa.depth / 2 - 0.014)) ** 2 >
                1)
          );
        })
      )
        throw new Error("Attached item exceeds its supporting surface.");
      for (const other of all) {
        if (
          other.id === item.id ||
          other.id === parentId ||
          other.locationId !== item.locationId ||
          other.attachment?.kind === "storage" ||
          ("lifecycle" in other && other.lifecycle !== "active")
        )
          continue;
        const [ow, od, oh] = footprint(home, other);
        if (
          other.position[1] + oh > item.position[1] + 0.002 &&
          other.position[1] < item.position[1] + h - 0.002 &&
          overlaps(
            polygon,
            corners(
              [other.position[0], other.position[2]],
              ow,
              od,
              other.rotation ?? 0,
            ),
            0.001,
          )
        )
          throw new Error(
            "Attached item overlaps another object; review the placement or quantity.",
          );
      }
    }
  }
}
export interface SurfacePlan {
  position: [number, number, number];
  rotation: number;
  local: Point2;
  width: number;
  depth: number;
}
export function planSurface(
  home: HomeTemplate,
  itemId: string,
  supportId: string,
  preferred: Point2 = [0, 0],
  quarterTurn = false,
): SurfacePlan {
  const all = items(home),
    item = all.find((i) => i.id === itemId),
    support = home.entities.find((e) => e.id === supportId);
  if (
    !item ||
    !support ||
    itemId === supportId ||
    !isSurface(home, support) ||
    !physicallyActive(home, support) ||
    support.attachment?.kind === "storage" ||
    ("scope" in item &&
      (item.scope === "remote" || item.lifecycle !== "active"))
  )
    throw new Error("请选择可摆放的物品和家庭台面。");
  let ancestor: SpatialItem | undefined = support;
  const visited = new Set<string>();
  while (ancestor) {
    if (visited.has(ancestor.id)) throw new Error("Containment cycle.");
    visited.add(ancestor.id);
    if (ancestor.id === itemId)
      throw new Error("不能把容器放到自己的内容物上。");
    ancestor = all.find((i) => i.id === ancestor?.attachment?.parentId);
  }
  const sa = assetFor(home, support),
    [w, d, h] = footprint(home, item),
    yaw = quarterTurn ? Math.PI / 2 : 0,
    rotation = support.rotation + yaw;
  const width = quarterTurn ? d : w,
    depth = quarterTurn ? w : d,
    margin = 0.015;
  const maxX = (sa.width - width) / 2 - margin,
    maxZ = (sa.depth - depth) / 2 - margin;
  if (maxX < 0 || maxZ < 0)
    throw new Error("物品超出台面边界，请换台面或旋转后再试。");
  const y = support.position[1] + sa.height;
  const obstacles = all
    .filter(
      (o) =>
        o.id !== itemId &&
        o.id !== supportId &&
        o.locationId === support.locationId &&
        o.attachment?.kind !== "storage" &&
        (!("lifecycle" in o) || o.lifecycle === "active"),
    )
    .filter((o) => {
      const oh = footprint(home, o)[2];
      return o.position[1] + oh > y + 0.002 && o.position[1] < y + h - 0.002;
    })
    .map((o) => {
      const [ow, od] = footprint(home, o);
      return corners([o.position[0], o.position[2]], ow, od, o.rotation ?? 0);
    });
  const candidates: Point2[] = [
    [
      Math.max(-maxX, Math.min(maxX, preferred[0])),
      Math.max(-maxZ, Math.min(maxZ, preferred[1])),
    ],
  ];
  // Bound the search even on large tables; all candidates are still checked exactly.
  const nx = Math.min(100, Math.max(1, Math.ceil((maxX * 2) / 0.025))),
    nz = Math.min(100, Math.max(1, Math.ceil((maxZ * 2) / 0.025)));
  for (let ix = 0; ix <= nx; ix++)
    for (let iz = 0; iz <= nz; iz++)
      candidates.push([
        -maxX + (2 * maxX * ix) / nx,
        -maxZ + (2 * maxZ * iz) / nz,
      ]);
  candidates.sort(
    (a, b) =>
      Math.hypot(a[0] - preferred[0], a[1] - preferred[1]) -
      Math.hypot(b[0] - preferred[0], b[1] - preferred[1]),
  );
  for (const local of candidates) {
    const offset = rotate(local, support.rotation),
      x = support.position[0] + offset[0],
      z = support.position[2] + offset[1];
    const polygon = corners([x, z], w, d, rotation);
    const room = home.rooms.find((r) => r.id === support.locationId)!;
    const fits = polygon.every(
      ([px, pz]) =>
        Math.abs(px) <= room.size[0] / 2 + 1e-7 &&
        Math.abs(pz) <= room.size[1] / 2 + 1e-7 &&
        (!room.footprint || pointInFootprint(px, pz, room.footprint)),
    );
    const onRoundTop =
      sa.kind !== "round-storage-table" ||
      corners(local, width, depth, 0).every(
        ([px, pz]) =>
          (px / (sa.width / 2 - margin)) ** 2 +
            (pz / (sa.depth / 2 - margin)) ** 2 <=
          1,
      );
    if (fits && onRoundTop && !obstacles.some((o) => overlaps(polygon, o)))
      return { position: [x, y, z], rotation, local, width, depth };
  }
  throw new Error("台面没有足够空位；现有物品保持原位。可换台面或调整朝向。");
}
// Follow explicit links only. Positions remain room-relative for existing clients.
export function followAttachments(
  home: HomeTemplate,
  before: HomeTemplate,
  explicitlyMoved: Set<string>,
) {
  const all = items(home),
    old = new Map(items(before).map((i) => [i.id, i])),
    visited = new Set<string>();
  const follow = (item: SpatialItem) => {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    if (!item.attachment || explicitlyMoved.has(item.id)) return;
    const parent = home.entities.find(
        (e) => e.id === item.attachment!.parentId,
      ),
      previous = old.get(item.attachment.parentId),
      prior = old.get(item.id);
    if (!parent || !previous || !prior) return;
    follow(parent);
    if (
      parent.locationId === previous.locationId &&
      parent.rotation === (previous.rotation ?? 0) &&
      parent.position.every(
        (value, index) => value === previous.position[index],
      ) &&
      (item.attachment.kind !== "surface" ||
        assetFor(home, parent).height === assetFor(before, previous).height)
    )
      return;
    const delta = parent.rotation - (previous.rotation ?? 0),
      offset = rotate(
        [
          prior.position[0] - previous.position[0],
          prior.position[2] - previous.position[2],
        ],
        delta,
      );
    item.locationId = parent.locationId;
    const y =
      item.attachment.kind === "surface"
        ? parent.position[1] + assetFor(home, parent).height
        : parent.position[1] + prior.position[1] - previous.position[1];
    item.position = [
      parent.position[0] + offset[0],
      y,
      parent.position[2] + offset[1],
    ];
    item.rotation = (prior.rotation ?? 0) + delta;
  };
  all.forEach(follow);
}

export function planFloor(
  home: HomeTemplate,
  itemId: string,
  roomId: string,
): SurfacePlan {
  const item = items(home).find((i) => i.id === itemId),
    room = home.rooms.find((r) => r.id === roomId);
  if (!item || !room || room.kind !== "room")
    throw new Error("请选择家庭房间。");
  const id = "virtual-floor-" + itemId;
  const asset: SceneAsset = {
    id,
    name: "Floor",
    kind: "table",
    width: room.size[0],
    depth: room.size[1],
    height: 0,
    color: "#ffffff",
    provenance: "Transient solver boundary",
  };
  const support: Entity = {
    id,
    name: "Floor",
    assetId: id,
    category: "object",
    scope: "home",
    lifecycle: "active",
    locationId: roomId,
    position: [0, 0, 0],
    rotation: 0,
    placementConfirmed: false,
    description: "",
    notes: "",
    tags: [],
    source: "user",
    asOf: "",
  };
  return planSurface(
    {
      ...home,
      entities: [...home.entities, support],
      assets: [...home.assets, asset],
    },
    itemId,
    id,
  );
}

/** Visible physical descendants; storage is deliberately closed at this level. */
export function inspectionItems(
  home: SpatialHomeLike,
  id: string,
): Set<string> {
  const visible = new Set([id]);
  const all: SpatialItemLike[] = [...home.entities, ...(home.stocks ?? [])];
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of all) {
      if (
        item.attachment &&
        item.attachment.kind !== "storage" &&
        visible.has(item.attachment.parentId) &&
        !visible.has(item.id)
      ) {
        visible.add(item.id);
        changed = true;
      }
    }
  }
  return visible;
}

/** A small record stays in the context of its first substantial support. */
export function focusAnchor(
  home: SpatialHomeLike,
  id: string,
): SpatialItemLike | undefined {
  const all: SpatialItemLike[] = [...home.entities, ...(home.stocks ?? [])];
  let item = all.find((i) => i.id === id);
  const seen = new Set<string>();
  while (item && !seen.has(item.id)) {
    seen.add(item.id);
    const asset = assetFor(home, item);
    if (
      (asset.width >= 0.6 &&
        asset.height >= 0.35 &&
        !["screen", "laptop", "monitor-arm", "dual-monitor-arm"].includes(
          asset.kind,
        )) ||
      !item.attachment
    )
      return item;
    item = all.find((i) => i.id === item!.attachment!.parentId);
  }
  return item;
}
export const lightKinds = new Set(["ceiling-light", "desk-lamp"]);
