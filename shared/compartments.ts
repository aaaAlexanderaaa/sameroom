import { z } from "zod";

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/);
export const compartmentSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["shelf", "drawer"]),
  split: z
    .object({
      axis: z.enum(["x", "y"]),
      ratio: z.number().min(0.08).max(0.92),
      first: identifier,
      second: identifier,
    })
    .optional(),
});
export const interiorSchema = z.object({
  root: identifier,
  parts: z.array(compartmentSchema).min(1).max(63),
});
export type Interior = z.infer<typeof interiorSchema>;
export type Compartment = z.infer<typeof compartmentSchema>;
export interface Region {
  part: Compartment;
  x: number;
  y: number;
  width: number;
  height: number;
  parent?: string;
}
export const emptyInterior = (): Interior => ({
  root: "main",
  parts: [{ id: "main", name: "整个空间", kind: "shelf" }],
});

export function regions(interior: Interior): Region[] {
  const result: Region[] = [],
    seen = new Set<string>();
  const visit = (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    parent?: string,
  ) => {
    const part = interior.parts.find((p) => p.id === id);
    if (!part || seen.has(id))
      throw new Error("Compartment tree has a missing or repeated region.");
    seen.add(id);
    result.push({ part, x, y, width, height, parent });
    if (!part.split) return;
    const { axis, ratio, first, second } = part.split;
    if (axis === "x") {
      visit(first, x, y, width * ratio, height, id);
      visit(second, x + width * ratio, y, width * (1 - ratio), height, id);
    } else {
      visit(first, x, y, width, height * ratio, id);
      visit(second, x, y + height * ratio, width, height * (1 - ratio), id);
    }
  };
  visit(interior.root, 0, 0, 1, 1);
  if (seen.size !== interior.parts.length)
    throw new Error(
      "Compartment tree contains duplicate or unreachable regions.",
    );
  return result;
}
export const leaves = (interior: Interior) =>
  regions(interior).filter((r) => !r.part.split);
export function firstLeaf(interior: Interior, id = interior.root): string {
  const part = interior.parts.find((p) => p.id === id);
  if (!part) throw new Error("Unknown compartment.");
  return part.split ? firstLeaf(interior, part.split.first) : part.id;
}
/** Stable identity through split/merge, including legacy contents in the root. */
export function remapCompartment(
  previous: Interior,
  next: Interior,
  id?: string,
) {
  let cursor = id ?? previous.root;
  const oldRegions = regions(previous);
  while (!next.parts.some((p) => p.id === cursor)) {
    const parent = oldRegions.find((r) => r.part.id === cursor)?.parent;
    if (!parent)
      throw new Error(
        "Removing a compartment requires merging it into a retained ancestor.",
      );
    cursor = parent;
  }
  return firstLeaf(next, cursor);
}
export function splitRegion(
  interior: Interior,
  id: string,
  axis: "x" | "y",
  first: string,
  second: string,
): Interior {
  const next = structuredClone(interior),
    part = next.parts.find((p) => p.id === id)!;
  if (!part || part.split || next.parts.length > 61)
    throw new Error("最多可划分 32 个隔间。");
  part.split = { axis, ratio: 0.5, first, second };
  next.parts.push(
    { id: first, name: axis === "x" ? "左侧" : "上层", kind: part.kind },
    { id: second, name: axis === "x" ? "右侧" : "下层", kind: part.kind },
  );
  return next;
}
export function mergeRegion(interior: Interior, id: string): Interior {
  const next = structuredClone(interior),
    remove = new Set<string>();
  const collect = (key: string) => {
    const part = next.parts.find((p) => p.id === key)!;
    if (part.split) {
      collect(part.split.first);
      collect(part.split.second);
    }
    if (key !== id) remove.add(key);
  };
  collect(id);
  next.parts = next.parts.filter((p) => !remove.has(p.id));
  delete next.parts.find((p) => p.id === id)!.split;
  return next;
}
