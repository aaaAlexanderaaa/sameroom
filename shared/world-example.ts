import workshop from "../examples/workshop.json" with { type: "json" };
import { validateTemplate, type HomeTemplate, type Entity } from "./domain.js";
import { cyberSchema } from "./cyber.js";

/** Explicit preview only; callers never replace the owner's home implicitly. */
export function worldExample(): HomeTemplate {
  const h = validateTemplate(structuredClone(workshop));
  h.id = "worlds-demo";
  h.name = "三种视角 · 示例小世界";
  h.sourceLabel = "合成示例 · 与实际家庭记录无关";
  h.schematic = false;
  const base = h.entities[0];
  const add = (
    id: string,
    name: string,
    assetId: string,
    locationId: string,
    position: [number, number, number],
    category: Entity["category"] = "host",
  ) => {
    h.entities.push({
      ...base,
      id,
      name,
      assetId,
      locationId,
      position,
      category,
      scope: locationId === "remote" ? "remote" : "home",
      notes: "",
      description: "合成示例",
      placementConfirmed: locationId !== "remote",
    });
  };
  h.assets.push(
    {
      id: "bedside-model",
      name: "床头柜",
      kind: "bedside-cabinet",
      width: 1,
      height: 0.55,
      depth: 0.5,
      color: "#b5c4b4",
      provenance: "Authored example",
    },
    {
      id: "label-example",
      name: "备用转接头",
      kind: "label",
      width: 0.1,
      height: 0.08,
      depth: 0.05,
      color: "#b5c4b4",
      provenance: "Text-only example",
    },
    {
      id: "bag-example",
      name: "洗衣凝珠",
      kind: "bag",
      width: 0.16,
      height: 0.22,
      depth: 0.1,
      color: "#b5c4b4",
      provenance: "Text-only example",
    },
  );
  add("bedside", "床头柜", "bedside-model", "living", [0, 0, -1], "object");
  for (let i = 1; i <= 3; i++)
    add(`mini-${i}`, `小主机 ${i}`, "mini", "living", [
      -0.32 + (i - 1) * 0.32,
      0.55,
      -1,
    ]);
  add("macbook", "MacBook", "mini", "study", [0.5, 0.76, 1]);
  add("cloud-west", "云端备份", "tower", "remote", [1, 0, 1]);
  add("adapter", "备用转接头", "label-example", "living", [0, 0, -1], "object");
  h.entities.find((e) => e.id === "adapter")!.attachment = {
    kind: "storage",
    parentId: "bedside",
    slot: 0,
    compartmentId: "drawer",
  };
  h.stocks.push({
    id: "capsules",
    name: "洗衣凝珠",
    sku: "capsules",
    unit: "颗",
    quantity: 20,
    threshold: 5,
    assetId: "bag-example",
    locationId: "study",
    position: [0, 0, -1],
    capacity: 100000,
    sample: true,
    attachment: {
      kind: "storage",
      parentId: "wardrobe",
      slot: 0,
      compartmentId: "upper",
    },
  });
  h.assets.push({
    id: "power-example",
    name: "示例插线板",
    kind: "smart-strip",
    width: 0.32,
    height: 0.05,
    depth: 0.08,
    color: "#ddddcc",
    provenance: "Authored example",
  });
  add(
    "bedside-power",
    "床头供电",
    "power-example",
    "living",
    [0, 0.55, -1.15],
    "device",
  );
  h.electricalCircuits = [
    {
      id: "bedside-supply",
      name: "床头供电",
      controllerEntityId: "bedside-power",
      metering: "aggregate",
      source: "sample",
      asOf: "2026-11-14",
      channels: [
        {
          id: "shared",
          name: "共用供电",
          entityIds: ["mini-1", "mini-2", "mini-3"],
        },
      ],
    },
  ];
  h.storage = [
    {
      entityId: "wardrobe",
      columns: 4,
      rows: 4,
      interior: {
        root: "main",
        parts: [
          {
            id: "main",
            name: "收纳柜",
            kind: "shelf",
            split: { axis: "y", ratio: 0.3, first: "upper", second: "lower" },
          },
          { id: "upper", name: "清洁用品", kind: "shelf" },
          { id: "lower", name: "备用物品", kind: "shelf" },
        ],
      },
    },
    {
      entityId: "bedside",
      columns: 4,
      rows: 4,
      interior: {
        root: "main",
        parts: [
          {
            id: "main",
            name: "床头柜",
            kind: "shelf",
            split: { axis: "y", ratio: 0.4, first: "drawer", second: "lower" },
          },
          { id: "drawer", name: "配件抽屉", kind: "drawer" },
          { id: "lower", name: "下层", kind: "shelf" },
        ],
      },
    },
  ];
  h.cyber = cyberSchema.parse({
    version: 1,
    source: "demo.worlds",
    asOf: "2026-11-14T00:00:00Z",
    nodes: [
      {
        id: "app",
        label: "个人应用",
        host: "studio-mini",
        groups: ["数据库访问", "出网"],
      },
      {
        id: "db",
        label: "PostgreSQL",
        host: "home-nas",
        kind: "database",
        groups: ["数据库访问"],
      },
      {
        id: "proxy",
        label: "出网代理",
        host: "mini-1",
        kind: "gateway",
        groups: ["出网"],
      },
      {
        id: "route",
        label: "虚拟路由",
        host: "mini-2",
        kind: "gateway",
        groups: ["出网"],
      },
      {
        id: "media",
        label: "媒体服务",
        host: "mini-3",
        groups: ["媒体", "数据库访问"],
      },
      {
        id: "work",
        label: "开发工作区",
        host: "macbook",
        groups: ["出网", "数据库访问"],
      },
      {
        id: "gateway",
        label: "远端网关",
        host: "cloud-node",
        kind: "gateway",
        groups: ["出网"],
      },
      { id: "backup", label: "对象备份", host: "cloud-west", groups: ["备份"] },
      { id: "api", label: "外部 API", kind: "external", groups: ["出网"] },
    ],
    edges: [
      {
        id: "a-db",
        source: "app",
        target: "db",
        label: "SQL",
        groups: ["数据库访问"],
      },
      { id: "m-db", source: "media", target: "db", groups: ["数据库访问"] },
      { id: "w-db", source: "work", target: "db", groups: ["数据库访问"] },
      { id: "a-p", source: "app", target: "proxy", groups: ["出网"] },
      { id: "w-p", source: "work", target: "proxy", groups: ["出网"] },
      { id: "p-r", source: "proxy", target: "route", groups: ["出网"] },
      {
        id: "r-g",
        source: "route",
        target: "gateway",
        label: "隧道",
        groups: ["出网"],
      },
      {
        id: "g-api",
        source: "gateway",
        target: "api",
        label: "HTTPS",
        groups: ["出网"],
      },
      {
        id: "db-b",
        source: "db",
        target: "backup",
        label: "定时备份",
        groups: ["备份"],
      },
    ],
    clouds: [
      {
        host: "cloud-node",
        provider: "示例云 A",
        region: "亚太",
        direction: "south",
      },
      {
        host: "cloud-west",
        provider: "示例云 B",
        region: "欧洲",
        direction: "west",
      },
    ],
  });
  return validateTemplate(h);
}
