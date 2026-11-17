import { type Action, type HomeTemplate, type SceneAsset } from "./domain.js";

export type LayoutCommit = Extract<Action, { type: "layout.commit" }>;
export type Placement = LayoutCommit["placements"][number];
export const furnitureNames: Partial<Record<SceneAsset["kind"], string>> = {
  table: "桌子",
  bed: "床",
  wardrobe: "衣柜",
  shelf: "置物架",
  cabinet: "矮柜",
  chair: "椅子",
  sofa: "沙发",
  fridge: "冰箱",
  washer: "洗衣机",
  sink: "水槽",
  toilet: "马桶",
  screen: "屏幕 / 电视",
  rug: "地毯",
  box: "收纳箱",
  plant: "盆栽",
  "gaming-chair": "电竞椅",
  "metal-shelf": "铁艺置物架",
  "drawer-cabinet": "抽屉柜",
  "bedside-cabinet": "床头柜",
  "display-cabinet": "展示收纳柜",
  "glass-cabinet": "窄玻璃柜",
  "mini-fridge": "桌下小冰箱",
  "kitchen-counter": "水槽灶台一体柜",
  keyboard: "键盘",
  mouse: "鼠标与鼠标垫",
  microphone: "悬臂麦克风",
  mug: "杯子",
  headphones: "耳机与支架",
  fan: "落地扇",
  beanbag: "豆袋椅",
  bench: "长凳",
  "sliding-door": "玻璃移门",
  "litter-tray": "猫砂盆",
  "privacy-screen": "落地屏风",
  pegboard: "洞洞板",
  "round-storage-table": "圆形储物茶几",
  armchair: "双扶手单人沙发",
  "wall-display": "壁挂电视",
  "window-marker": "窗户位置（编辑时可见）",
  "door-marker": "门洞位置（编辑时可见）",
  "wall-return": "墙体凸起（编辑时可见）",
  "mac-mini": "Mac mini",
  "mini-pc": "迷你主机",
  "single-board": "单板电脑",
  "desktop-pc": "台式主机",
  "air-conditioner": "壁挂空调",
  "smart-speaker": "智能音箱",
  "homepod-mini": "HomePod mini",
  "smart-strip": "独立计量插排",
  "smart-switch": "智能墙壁开关",
  "ceiling-light": "吸顶灯",
  plug: "计量智能插座",
  laptop: "笔记本电脑",
  "desktop-speaker": "桌面音响",
  "desk-lamp": "可调向台灯",
  "monitor-arm": "单臂显示器支架",
  "dual-monitor-arm": "双臂显示器支架",
};
export const furnitureSizes: Partial<
  Record<SceneAsset["kind"], [number, number, number]>
> = {
  table: [1.8, 0.75, 0.8],
  bed: [1.5, 0.65, 2.2],
  wardrobe: [2.4, 2.2, 0.6],
  shelf: [1, 1.8, 0.4],
  cabinet: [1.2, 0.8, 0.45],
  chair: [0.6, 1, 0.6],
  sofa: [2.2, 0.9, 0.9],
  fridge: [0.65, 1.8, 0.65],
  washer: [0.6, 0.85, 0.6],
  sink: [0.9, 0.85, 0.6],
  toilet: [0.42, 0.8, 0.7],
  screen: [1.1, 0.7, 0.12],
  rug: [2, 0.02, 1.5],
  box: [0.5, 0.5, 0.5],
  plant: [0.4, 0.8, 0.4],
  "gaming-chair": [0.65, 1.2, 0.68],
  "metal-shelf": [0.55, 1.7, 0.4],
  "drawer-cabinet": [0.6, 0.95, 0.5],
  "bedside-cabinet": [0.5, 0.55, 0.45],
  "display-cabinet": [2.2, 2.1, 0.4],
  "glass-cabinet": [0.42, 1.7, 0.4],
  "mini-fridge": [0.4, 0.62, 0.48],
  "kitchen-counter": [1.6, 1, 1.4],
  keyboard: [0.44, 0.028, 0.15],
  mouse: [0.22, 0.04, 0.22],
  microphone: [0.46, 0.5, 0.3],
  mug: [0.11, 0.12, 0.09],
  headphones: [0.19, 0.29, 0.14],
  fan: [0.42, 1.2, 0.36],
  beanbag: [0.72, 0.72, 0.72],
  bench: [1.3, 0.46, 0.36],
  "sliding-door": [1.35, 2.15, 0.07],
  "litter-tray": [0.55, 0.18, 0.4],
  "privacy-screen": [0.4, 1.8, 0.08],
  pegboard: [0.76, 0.56, 0.025],
  "round-storage-table": [0.6, 0.45, 0.6],
  armchair: [0.8, 0.8, 0.8],
  "wall-display": [1.1, 0.68, 0.07],
  "window-marker": [1.1, 1.5, 0.04],
  "door-marker": [0.8, 2.1, 0.08],
  "wall-return": [0.1, 2.5, 0.24],
  "mac-mini": [0.197, 0.036, 0.197],
  "mini-pc": [0.13, 0.05, 0.13],
  "single-board": [0.1, 0.035, 0.075],
  "desktop-pc": [0.22, 0.43, 0.4],
  "air-conditioner": [0.85, 0.29, 0.2],
  "smart-speaker": [0.14, 0.09, 0.07],
  "homepod-mini": [0.098, 0.084, 0.098],
  "smart-strip": [0.28, 0.035, 0.065],
  "smart-switch": [0.086, 0.086, 0.018],
  "ceiling-light": [0.38, 0.06, 0.38],
  plug: [0.06, 0.07, 0.055],
  laptop: [0.36, 0.27, 0.27],
  "desktop-speaker": [0.32, 0.11, 0.12],
  "desk-lamp": [0.18, 0.35, 0.22],
  "monitor-arm": [0.3, 0.5, 0.22],
  "dual-monitor-arm": [0.65, 0.5, 0.24],
};

/** Only spatial changes are submitted; notes, services and quantities stay owned by their commands. */
export function layoutChanges(
  base: HomeTemplate,
  draft: HomeTemplate,
): LayoutCommit {
  const action: LayoutCommit = {
    type: "layout.commit",
    additions: [],
    placements: [],
  };
  if (JSON.stringify(base.rooms) !== JSON.stringify(draft.rooms))
    action.rooms = draft.rooms;
  for (const kind of ["entity", "stock"] as const) {
    const current = kind === "entity" ? draft.entities : draft.stocks;
    const previous = kind === "entity" ? base.entities : base.stocks;
    for (const item of current) {
      const old = previous.find((e) => e.id === item.id);
      const asset = draft.assets.find((a) => a.id === item.assetId)!;
      if (!old) {
        if ("scope" in item) action.additions.push({ entity: item, asset });
        continue;
      }
      const spatial = (v: typeof item) =>
        JSON.stringify([
          v.locationId,
          v.position,
          v.rotation ?? 0,
          v.assetId,
          v.attachment,
          "placementConfirmed" in v ? v.placementConfirmed : false,
        ]);
      if (spatial(item) === spatial(old)) continue;
      // A related child's preview already follows its parent; the server derives
      // that same movement. Only direct edits detach and submit the child.
      if (
        item.attachment &&
        JSON.stringify(item.attachment) === JSON.stringify(old.attachment) &&
        item.assetId === old.assetId
      )
        continue;
      action.placements.push({
        kind,
        id: item.id,
        locationId: item.locationId,
        position: item.position,
        rotation: item.rotation ?? 0,
        placementConfirmed:
          "placementConfirmed" in item ? item.placementConfirmed : false,
        ...(old.assetId !== item.assetId ? { asset } : {}),
      });
    }
  }
  return action;
}
