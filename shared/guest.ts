import { z } from "zod";
import type { SceneAsset } from "./domain.js";

export const guestIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/);
const shortText = z.string().trim().min(1).max(160);
const coordinate = z.number().finite().min(-100).max(100);
const uploadPhotoUrl = z
  .string()
  .regex(/^\/api\/(?:guest\/)?uploads\/[a-f0-9]{64}$/);

export const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => {
    const parsed = new URL(value);
    return (
      ["https:", "http:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
    );
  }, "URL must be http or https without credentials.");

export const entityGuestSchema = z.object({
  visibility: z.enum(["show", "backdrop", "hide"]).default("show"),
  summary: z.string().trim().max(240).optional(),
});
export type EntityGuest = z.infer<typeof entityGuestSchema>;

export const hotspotIconKeys = [
  "mail",
  "images",
  "external-link",
  "app-window",
  "sparkles",
  "lightbulb",
  "compass",
  "heart",
  "music",
  "book",
  "star",
  "coffee",
  "camera",
  "pin",
] as const;
export type HotspotIconKey = (typeof hotspotIconKeys)[number];

export const hotspotVisualSchema = z.object({
  icon: z.enum(hotspotIconKeys).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  size: z.enum(["sm", "md", "lg"]).default("md"),
  pulse: z.enum(["soft", "beacon", "static"]).default("soft"),
});
export type HotspotVisual = z.infer<typeof hotspotVisualSchema>;

export const hotspotAnchorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("room"),
    locationId: guestIdSchema,
    position: z.tuple([coordinate, coordinate, coordinate]),
  }),
  z.object({
    kind: z.literal("entity"),
    entityId: guestIdSchema,
    offset: z.tuple([coordinate, coordinate, coordinate]).default([0, 0.28, 0]),
  }),
]);
export type HotspotAnchor = z.infer<typeof hotspotAnchorSchema>;

export const hotspotEffectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("envelope"),
    title: shortText,
    sender: z.string().trim().max(80).optional(),
    recipient: z.string().trim().max(80).optional(),
    date: z.string().trim().max(40).optional(),
    sealText: z.string().trim().max(8).optional(),
    theme: z.enum(["cream", "kraft", "night"]).default("cream"),
    typewriter: z.boolean().optional(),
    typingDurationSeconds: z.number().finite().min(8).max(60).optional(),
    body: z.string().trim().min(1).max(6000),
    signature: z.string().trim().max(80).optional(),
    photo: uploadPhotoUrl.optional(),
  }),
  z.object({
    kind: z.literal("album"),
    title: shortText,
    subtitle: z.string().trim().max(240).optional(),
    layout: z.enum(["lightbox", "polaroid"]).default("lightbox"),
    items: z
      .array(
        z.object({
          photo: uploadPhotoUrl,
          caption: z.string().trim().max(160).optional(),
          date: z.string().trim().max(40).optional(),
          story: z.string().trim().max(1000).optional(),
        }),
      )
      .min(1)
      .max(24),
  }),
  z.object({
    kind: z.literal("link"),
    title: shortText,
    description: z.string().trim().max(600).optional(),
    url: httpUrlSchema,
    buttonLabel: z.string().trim().max(60).optional(),
    openMode: z.enum(["card", "direct"]).default("card"),
  }),
  z.object({
    kind: z.literal("iframe"),
    title: shortText,
    description: z.string().trim().max(600).optional(),
    url: httpUrlSchema,
    aspectRatio: z.enum(["16:9", "4:3", "tall"]).default("16:9"),
  }),
  z.object({
    kind: z.literal("spotlight"),
    title: shortText,
    badge: z.string().trim().max(40).optional(),
    presentation: z.enum(["dock", "popup"]).optional(),
    story: z.string().trim().min(1).max(2000),
    targetEntityId: guestIdSchema.optional(),
    cameraOffset: z
      .tuple([
        z.number().finite().min(-30).max(30),
        z.number().finite().min(0.2).max(30),
        z.number().finite().min(-30).max(30),
      ])
      .optional(),
    zoom: z.number().finite().min(0.5).max(30).optional(),
    photo: uploadPhotoUrl.optional(),
  }),
  z.object({
    kind: z.literal("variant"),
    title: shortText,
    entityId: guestIdSchema,
    description: z.string().trim().max(240).optional(),
    assetIds: z.array(guestIdSchema).min(2).max(12).optional(),
  }),
]);
export type HotspotEffect = z.infer<typeof hotspotEffectSchema>;

export const hotspotSchema = z.object({
  id: guestIdSchema,
  label: shortText,
  audience: z
    .enum(["guest-and-admin", "guest-only", "admin-only"])
    .default("guest-and-admin"),
  anchor: hotspotAnchorSchema,
  visual: hotspotVisualSchema.default({ size: "md", pulse: "soft" }),
  effect: hotspotEffectSchema,
});
export type Hotspot = z.infer<typeof hotspotSchema>;

export const hotspotEffectDefaults: Record<
  HotspotEffect["kind"],
  { icon: HotspotIconKey; color: string; label: string }
> = {
  envelope: { icon: "mail", color: "#b65a44", label: "信封信件" },
  album: { icon: "images", color: "#3d7a64", label: "相册故事" },
  link: { icon: "external-link", color: "#35688c", label: "外部网站" },
  iframe: { icon: "app-window", color: "#58569c", label: "内嵌网页" },
  spotlight: { icon: "sparkles", color: "#b67c2c", label: "视角故事" },
  variant: { icon: "lightbulb", color: "#a88324", label: "外观彩蛋" },
};

export function resolveHotspotVisual(hotspot: Hotspot): {
  icon: HotspotIconKey;
  color: string;
  size: "sm" | "md" | "lg";
  pulse: "soft" | "beacon" | "static";
} {
  const defaults = hotspotEffectDefaults[hotspot.effect.kind];
  return {
    icon: hotspot.visual?.icon ?? defaults.icon,
    color: hotspot.visual?.color ?? defaults.color,
    size: hotspot.visual?.size ?? "md",
    pulse: hotspot.visual?.pulse ?? "soft",
  };
}

export interface GuestRoomLike {
  id: string;
  name: string;
  kind: "room" | "unplaced" | "remote";
  origin: [number, number, number];
  size: [number, number];
  color: string;
  footprint?: [number, number][];
}

export interface GuestEntityLike {
  id: string;
  name: string;
  category: "host" | "device" | "object";
  scope?: "home" | "remote";
  lifecycle?: "active" | "retired";
  locationId: string;
  position: [number, number, number];
  rotation: number;
  assetId: string;
  visibility?: "always" | "editing";
  attachment?: {
    parentId: string;
    kind: "surface" | "storage" | "mount";
  };
  guest?: EntityGuest;
}

export type GuestAsset = Omit<SceneAsset, "provenance" | "source">;

export interface GuestEntity {
  id: string;
  name: string;
  category: "host" | "device" | "object";
  locationId: string;
  position: [number, number, number];
  rotation: number;
  assetId: string;
  guestInteraction: "focus" | "backdrop";
  publicSummary?: string;
}

export interface GuestHome {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  schematic: boolean;
  rooms: GuestRoomLike[];
  assets: GuestAsset[];
  entities: GuestEntity[];
  hotspots: Hotspot[];
}

export interface GuestDashboard {
  schemaVersion: 1;
  revision: number;
  home: GuestHome;
}

export function resolveHotspotWorldPosition(
  home: {
    rooms: Pick<GuestRoomLike, "id" | "origin">[];
    entities: Pick<
      GuestEntityLike,
      "id" | "locationId" | "position" | "rotation"
    >[];
  },
  hotspot: Hotspot,
): [number, number, number] | undefined {
  const { anchor } = hotspot;
  if (anchor.kind === "room") {
    const room = home.rooms.find((r) => r.id === anchor.locationId);
    if (!room) return undefined;
    return [
      room.origin[0] + anchor.position[0],
      room.origin[1] + anchor.position[1],
      room.origin[2] + anchor.position[2],
    ];
  }
  const entity = home.entities.find((e) => e.id === anchor.entityId);
  if (!entity) return undefined;
  const room = home.rooms.find((r) => r.id === entity.locationId);
  if (!room) return undefined;
  const [dx, dy, dz] = anchor.offset ?? [0, 0.28, 0];
  const cos = Math.cos(entity.rotation);
  const sin = Math.sin(entity.rotation);
  const rx = dx * cos + dz * sin;
  const rz = -dx * sin + dz * cos;
  return [
    room.origin[0] + entity.position[0] + rx,
    room.origin[1] + entity.position[1] + dy,
    room.origin[2] + entity.position[2] + rz,
  ];
}

function toGuestPhotoUrl(url: string): string;
function toGuestPhotoUrl(url: string | undefined): string | undefined;
function toGuestPhotoUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace(/^\/api\/uploads\//, "/api/guest/uploads/");
}

function sanitizeHotspotForGuest(hotspot: Hotspot): Hotspot {
  const effect = hotspot.effect;
  if (effect.kind === "envelope" && effect.photo) {
    return {
      ...hotspot,
      effect: { ...effect, photo: toGuestPhotoUrl(effect.photo) },
    };
  }
  if (effect.kind === "spotlight" && effect.photo) {
    return {
      ...hotspot,
      effect: { ...effect, photo: toGuestPhotoUrl(effect.photo) },
    };
  }
  if (effect.kind === "album") {
    return {
      ...hotspot,
      effect: {
        ...effect,
        items: effect.items.map((item) => ({
          ...item,
          photo: toGuestPhotoUrl(item.photo),
        })),
      },
    };
  }
  return hotspot;
}

export function projectGuestDashboard(input: {
  revision: number;
  home: {
    id: string;
    name: string;
    description: string;
    schematic: boolean;
    guestTitle?: string;
    guestSubtitle?: string;
    rooms: GuestRoomLike[];
    assets: SceneAsset[];
    entities: GuestEntityLike[];
    hotspots?: Hotspot[];
  };
}): GuestDashboard {
  const rooms = input.home.rooms
    .filter((r) => r.kind === "room")
    .map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      origin: [...r.origin] as [number, number, number],
      size: [...r.size] as [number, number],
      color: r.color,
      ...(r.footprint
        ? { footprint: r.footprint.map((p) => [...p] as [number, number]) }
        : {}),
    }));
  const roomIds = new Set(rooms.map((r) => r.id));
  const byId = new Map(input.home.entities.map((e) => [e.id, e]));

  const isEntityGuestVisible = (
    entity: GuestEntityLike,
    visited = new Set<string>(),
  ): boolean => {
    if (visited.has(entity.id)) return false;
    visited.add(entity.id);
    if (entity.lifecycle && entity.lifecycle !== "active") return false;
    if (entity.scope && entity.scope !== "home") return false;
    if (entity.visibility === "editing") return false;
    if (!roomIds.has(entity.locationId)) return false;
    if (entity.guest?.visibility === "hide") return false;
    if (entity.attachment?.kind === "storage") return false;
    if (entity.attachment) {
      const parent = byId.get(entity.attachment.parentId);
      if (!parent || !isEntityGuestVisible(parent, visited)) return false;
    }
    return true;
  };

  const entities: GuestEntity[] = input.home.entities
    .filter((e) => isEntityGuestVisible(e))
    .map((e) => ({
      id: e.id,
      name: e.name,
      category: e.category,
      locationId: e.locationId,
      position: [...e.position] as [number, number, number],
      rotation: e.rotation,
      assetId: e.assetId,
      guestInteraction:
        e.guest?.visibility === "backdrop" ? "backdrop" : "focus",
      ...(e.guest?.summary ? { publicSummary: e.guest.summary } : {}),
    }));
  const entityIds = new Set(entities.map((e) => e.id));

  const hotspots = (input.home.hotspots ?? [])
    .filter((h) => {
      if (h.audience === "admin-only") return false;
      if (h.anchor.kind === "room") return roomIds.has(h.anchor.locationId);
      if (!entityIds.has(h.anchor.entityId)) return false;
      if (
        h.effect.kind === "spotlight" &&
        h.effect.targetEntityId &&
        !entityIds.has(h.effect.targetEntityId)
      )
        return false;
      if (h.effect.kind === "variant" && !entityIds.has(h.effect.entityId))
        return false;
      return true;
    })
    .map(sanitizeHotspotForGuest);

  const usedAssetIds = new Set(entities.map((e) => e.assetId));
  for (const h of hotspots) {
    const { effect } = h;
    if (effect.kind !== "variant") continue;
    const target = entities.find((e) => e.id === effect.entityId);
    const targetAsset = target
      ? input.home.assets.find((a) => a.id === target.assetId)
      : undefined;
    if (effect.assetIds?.length) {
      for (const aid of effect.assetIds) usedAssetIds.add(aid);
    } else if (targetAsset?.variant?.group) {
      for (const a of input.home.assets) {
        if (a.variant?.group === targetAsset.variant.group) {
          usedAssetIds.add(a.id);
        }
      }
    }
  }

  const assets: GuestAsset[] = input.home.assets
    .filter((a) => usedAssetIds.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      ...(a.url ? { url: a.url } : {}),
      ...(a.detailUrl ? { detailUrl: a.detailUrl } : {}),
      width: a.width,
      height: a.height,
      depth: a.depth,
      color: a.color,
      ...(a.variant ? { variant: { ...a.variant } } : {}),
      ...(a.modelRotation !== undefined
        ? { modelRotation: a.modelRotation }
        : {}),
      ...(a.front !== undefined ? { front: a.front } : {}),
      ...(a.stand ? { stand: a.stand } : {}),
      ...(a.glassPanels ? { glassPanels: [...a.glassPanels] } : {}),
      ...(a.lightTilt !== undefined ? { lightTilt: a.lightTilt } : {}),
    }));

  return {
    schemaVersion: 1,
    revision: input.revision,
    home: {
      schemaVersion: 1,
      id: input.home.id,
      name: input.home.guestTitle?.trim() || input.home.name,
      description: input.home.guestSubtitle?.trim() || input.home.description,
      schematic: input.home.schematic,
      rooms,
      assets,
      entities,
      hotspots,
    },
  };
}

export function guestMediaAllowlist(guestHome: GuestHome): {
  uploadIds: Set<string>;
  assetUrls: Set<string>;
} {
  const uploadIds = new Set<string>();
  const addUpload = (url: string | undefined) => {
    if (!url) return;
    const match = /^\/api\/(?:guest\/)?uploads\/([a-f0-9]{64})$/.exec(url);
    if (match) uploadIds.add(match[1]);
  };
  for (const hotspot of guestHome.hotspots) {
    if (hotspot.effect.kind === "envelope") addUpload(hotspot.effect.photo);
    if (hotspot.effect.kind === "spotlight") addUpload(hotspot.effect.photo);
    if (hotspot.effect.kind === "album") {
      for (const item of hotspot.effect.items) addUpload(item.photo);
    }
  }
  const assetUrls = new Set<string>();
  for (const asset of guestHome.assets) {
    if (asset.url) assetUrls.add(asset.url);
    if (asset.detailUrl) assetUrls.add(asset.detailUrl);
  }
  return { uploadIds, assetUrls };
}
