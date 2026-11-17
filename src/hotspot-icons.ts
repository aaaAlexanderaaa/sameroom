import type { HotspotIconKey } from "../shared/guest.js";

export const hotspotIconMeta: Record<
  HotspotIconKey,
  { label: string; paths: string[] }
> = {
  mail: {
    label: "信封",
    paths: [
      "M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z",
      "m22 8-10 6L2 8",
    ],
  },
  images: {
    label: "相册",
    paths: [
      "M18 22H4a2 2 0 0 1-2-2V6",
      "M22 13l-1.3-1.3a2.4 2.4 0 0 0-3.4 0L11 18",
      "M8 4h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
      "M12 9h.01",
    ],
  },
  "external-link": {
    label: "外链",
    paths: [
      "M15 3h6v6",
      "M10 14 21 3",
      "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
    ],
  },
  "app-window": {
    label: "网页窗",
    paths: [
      "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
      "M2 9h20",
      "M6 6.5h.01",
      "M10 6.5h.01",
    ],
  },
  sparkles: {
    label: "导览星光",
    paths: [
      "m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z",
      "M5 3v4",
      "M3 5h4",
    ],
  },
  lightbulb: {
    label: "彩蛋",
    paths: [
      "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5",
      "M9 18h6",
      "M10 22h4",
    ],
  },
  compass: {
    label: "罗盘",
    paths: [
      "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
      "m16.2 7.8-2 6.4-6.4 2 2-6.4 6.4-2Z",
    ],
  },
  heart: {
    label: "心意",
    paths: [
      "M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7 7-7Z",
    ],
  },
  music: {
    label: "音乐",
    paths: [
      "M9 18V5l12-2v13",
      "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
      "M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    ],
  },
  book: {
    label: "故事书",
    paths: ["M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"],
  },
  star: {
    label: "星标",
    paths: [
      "m12 2 3.1 6.3L22 9.3l-5 4.9 1.2 6.8L12 17.8 5.8 21 7 14.2 2 9.3l6.9-1L12 2Z",
    ],
  },
  coffee: {
    label: "日常",
    paths: [
      "M17 8h1a4 4 0 1 1 0 8h-1",
      "M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z",
      "M6 2v3",
      "M10 2v3",
      "M14 2v3",
    ],
  },
  camera: {
    label: "摄影",
    paths: [
      "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z",
      "M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    ],
  },
  pin: {
    label: "标记",
    paths: [
      "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z",
      "M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    ],
  },
};

export function createHotspotSvgElement(key: HotspotIconKey): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of hotspotIconMeta[key].paths) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
