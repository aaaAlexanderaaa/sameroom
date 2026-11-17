import type { HomeTemplate, SceneAsset } from "./domain.js";
import {
  assetFor,
  corners,
  inspectionItems,
  items,
  overlaps,
  rotate,
  type SpatialItem,
} from "./spatial.js";

type Point = [number, number, number];
interface Volume {
  center: Point;
  size: Point;
  yaw?: number;
}
/** Conservative solids for clearance diagnostics; open furniture is not a solid box. */
export function localVolumes(a: SceneAsset): Volume[] {
  const { width: w, height: h, depth: d, kind } = a;
  const box = (
    x: number,
    y: number,
    z: number,
    sw: number,
    sh: number,
    sd: number,
  ): Volume => ({ center: [x, y, z], size: [sw, sh, sd] });
  if (kind === "table" || kind === "bench")
    return [
      box(0, h - 0.03, 0, w, 0.06, d),
      ...[-1, 1].flatMap((x) =>
        [-1, 1].map((z) =>
          box(x * w * 0.42, (h - 0.06) / 2, z * d * 0.4, 0.05, h - 0.06, 0.05),
        ),
      ),
    ];
  if (kind === "metal-shelf" || kind === "shelf")
    return [
      ...[-1, 1].flatMap((x) =>
        [-1, 1].map((z) =>
          box(x * w * 0.46, h / 2, z * d * 0.44, 0.025, h, 0.025),
        ),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        box(0, 0.04 + (i * (h - 0.08)) / 4, 0, w, 0.025, d),
      ),
    ];
  if (kind === "kitchen-counter") {
    const run = Math.min(0.6, d / 2, w / 2);
    return [
      box(0, h / 2, -d / 2 + run / 2, w, h, run),
      box(w / 2 - run / 2, h / 2, run / 2, run, h, d - run),
    ];
  }
  if (["chair", "gaming-chair", "armchair", "sofa"].includes(kind))
    return [
      box(0, h * 0.43, 0, w * 0.8, h * 0.15, d * 0.8),
      // Chairs are authored toward -Z; sofas retain their +Z front.
      box(
        0,
        h * 0.72,
        d * (kind === "sofa" ? -0.35 : 0.35),
        w * 0.8,
        h * 0.55,
        d * 0.18,
      ),
      ...[-1, 1].flatMap((x) =>
        [-1, 1].map((z) =>
          box(x * w * 0.35, h * 0.2, z * d * 0.3, 0.045, h * 0.4, 0.045),
        ),
      ),
    ];
  if (
    kind === "monitor-arm" ||
    kind === "dual-monitor-arm" ||
    kind === "microphone"
  ) {
    // Thin mechanical members have deliberately conservative boxes, not a full swept envelope.
    const dual = kind === "dual-monitor-arm";
    const segments: [Point, Point][] =
      kind === "microphone"
        ? [
            [
              [-w * 0.4, 0, -d * 0.35],
              [-w * 0.39, h * 0.73, -d * 0.25],
            ],
            [
              [-w * 0.39, h * 0.73, -d * 0.25],
              [w * 0.3, h * 0.9, d * 0.23],
            ],
          ]
        : (dual ? [1, -1] : [1]).flatMap((branch) => {
            const x = dual ? -w * 0.18 : 0,
              y = (branch === 1 ? 0.78 : 0.43) * h,
              ex = dual ? branch * w * 0.46 : w * 0.32;
            return [
              [
                [x, 0, -d * 0.28],
                [x, h * 0.97, -d * 0.28],
              ],
              [
                [x, y, -d * 0.28],
                [ex * 0.5, y + h * 0.12, -d * 0.45],
              ],
              [
                [ex * 0.5, y + h * 0.12, -d * 0.45],
                [ex, y, d * (dual && branch === -1 ? 0.13 : 0.43)],
              ],
            ] as [Point, Point][];
          });
    return segments.map(([p, q]) => ({
      center: p.map((v, i) => (v + q[i]) / 2) as Point,
      size: [
        Math.hypot(q[0] - p[0], q[2] - p[2]) + 0.035,
        Math.abs(q[1] - p[1]) + 0.035,
        0.035,
      ],
      yaw: -Math.atan2(q[2] - p[2], q[0] - p[0]),
    }));
  }
  if (kind === "laptop")
    return [
      box(0, h * 0.035, 0, w, h * 0.065, d),
      box(0, h * 0.615, -d * 0.43, w * 0.91, h * 0.77, d * 0.05),
    ];
  if (
    kind === "rug" ||
    kind === "ceiling-light" ||
    kind === "desk-lamp" ||
    kind === "privacy-screen" ||
    kind === "pegboard"
  )
    return [];
  return [box(0, h / 2, 0, w, h, d)];
}
function volumes(home: HomeTemplate, item: SpatialItem) {
  return localVolumes(assetFor(home, item)).map((v) => {
    const [x, z] = rotate([v.center[0], v.center[2]], item.rotation ?? 0);
    return {
      bottom: item.position[1] + v.center[1] - v.size[1] / 2,
      top: item.position[1] + v.center[1] + v.size[1] / 2,
      polygon: corners(
        [item.position[0] + x, item.position[2] + z],
        v.size[0],
        v.size[2],
        (item.rotation ?? 0) + (v.yaw ?? 0),
      ),
    };
  });
}
export function layoutConflicts(
  home: HomeTemplate,
  locationId: string,
): [SpatialItem, SpatialItem][] {
  const all = items(home).filter(
    (i) =>
      i.locationId === locationId &&
      i.attachment?.kind !== "storage" &&
      (!("lifecycle" in i) ||
        (i.lifecycle === "active" && i.visibility !== "editing")),
  );
  const cache = new Map(all.map((i) => [i.id, volumes(home, i)])),
    links = new Map(all.map((i) => [i.id, inspectionItems(home, i.id)]));
  const found: [SpatialItem, SpatialItem][] = [];
  for (let i = 0; i < all.length; i++)
    for (const b of all.slice(i + 1)) {
      const a = all[i];
      if (links.get(a.id)?.has(b.id) || links.get(b.id)?.has(a.id)) continue;
      if (
        cache
          .get(a.id)!
          .some((av) =>
            cache
              .get(b.id)!
              .some(
                (bv) =>
                  Math.min(av.top, bv.top) - Math.max(av.bottom, bv.bottom) >
                    0.008 && overlaps(av.polygon, bv.polygon, -0.008),
              ),
          )
      )
        found.push([a, b]);
    }
  return found;
}
