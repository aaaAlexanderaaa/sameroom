# 空间、赛博与库存视图

从左下角**共在中枢**可以切换**赛博视图**、**库存视图**与**记一件物品**。默认房间使用环绕轨道相机，切回日常视图后会回到刚才的视角。**示例小世界**会在独立空间中打开一套可编辑的样例（包含本地设备、云端节点、连线路径、柜体抽屉和图文物品），改动不会影响你原本的房间。

## Record first, refine appearance later

A name plus a room or cabinet is enough. Optional quantity/unit creates a stock
balance; otherwise the record is an individual object. Up to eight photos are
normalized by the existing private upload endpoint and can be viewed or edited
without generation. Text labels, boxes, bottles and bags are authored placeholders.
Optional dimensions are approximate. A room-only entry has unconfirmed placement;
selecting a physical cabinet confirms that containment. Models can be associated
later through the existing capture workflow without changing object identity.

## Cabinet interiors

**编辑内部空间** is a front elevation. Select a region, split vertically or
horizontally, drag the divider or enter its percentage / distance in centimetres.
Leaves can be named shelves or drawers. The root inherits the cabinet's dimensions;
subdivisions scale proportionally with it. A maximum of 32 leaves keeps this a
small organizational tool. Undo/redo stays local until explicit save. A conflict
preserves the draft for review; an uncertain response reuses the original command.

Splitting retains contents in the first child (left or upper). Merging retains all
contents in the resulting ancestor. Region IDs stay stable regardless of rendered
card sizes, serving as a visual organizer for everyday shelf layout.
Legacy slot grids remain valid until an interior is explicitly saved.

Inventory view uses a perspective camera. WASD/arrows move without collision;
Space changes eye height between 0.4 and 1.6 m. Drag to look, or double-click the
scene to capture the mouse; Escape releases it. Touch has drag look and directional
buttons. The location selector approaches a cabinet. Nearby regions show items,
farther regions show summaries, and distant ones show markers. Click a drawer title
to pull it open. Contents retain readable tile dimensions rather than being scaled
to force everything into a small compartment. Full contents remain reachable through
the cabinet dialog. Shallow regions show clickable item-name summaries when a
full tile cannot fit; they never shrink tiles to squeeze them in. **待收纳** lists room-only and unplaced records and lets the
owner put them into a compartment. Fixed furniture and installed equipment are
excluded from that pending-possession list. Cabinet shells/interiors are schematic, including GLBs whose
individual door geometry is not identified.

## Small HomeLab graph contract

Use `cyber.replace` through the existing revisioned command API/CLI, or import the
same graph JSON from **导入 HomeLab 图**. One snapshot describes the current topology.
Stable node IDs and explicit host bindings let the platform arrange host panels
and connect services across them. No screen coordinates, SVG, HTML, scripts or
renderer configuration are accepted as graph content.

```json
{
  "version": 1,
  "source": "homelab",
  "asOf": "2026-11-14T00:00:00Z",
  "nodes": [
    { "id": "app", "label": "Application", "host": "studio-mini" },
    {
      "id": "db",
      "label": "PostgreSQL",
      "host": "home-nas",
      "kind": "database"
    },
    { "id": "api", "label": "External API", "kind": "external" }
  ],
  "edges": [
    {
      "id": "app-db",
      "source": "app",
      "target": "db",
      "label": "SQL",
      "groups": ["数据库访问"]
    },
    { "id": "app-api", "source": "app", "target": "api", "groups": ["出网"] }
  ]
}
```

These host IDs are synthetic examples. Read the actual state before generating a
household graph. `host` is an existing active entity ID. Optional `serviceId` binds
a node to an existing service owned by that host. `kind` is `service` (default),
`database`, `gateway` or `external`; only external endpoints may omit the host.
Nodes also accept optional architectural metadata (`size`: `large` | `medium` |
`small`; `layer`: `boundary` | `app` | `infra` | `middleware`; `boundary`:
`ingress` | `dns` | `egress` | `mesh`; `category`: built-in key or custom category
ID; and `zone`: isolation zone ID), inheriting optional defaults from a linked
`service` (`size`, `layer`, `boundary`, `category`, `zone`, `groups`) when
omitted on the node. Edges also accept optional `visibility` (`always` |
`hover`). Top-level optional `zones` (`id`, `label`, `isolation: "strict" |
"virtual"`, `hosts`, `groups`, `description`, `order`), `categories` (`label`,
`shortLabel`, `color`, `defaultLayer`, `order`), and `topologies` (`label`,
`description`, `color`, `order`) customize isolation boundaries and taxonomy
across both **机器为实** and **拓扑为实** views; when omitted,
`shared/cyber-arch.ts` derives semantic stratum, visual scale (`large` full
cards for primary apps/gateways/hubs, `medium` compact icon tiles for
middleware/databases, `small` icon-only badges for subordinate agents/probes),
hover-only quiet edges (when `visibility: "hover"` or attached to a `small`
node unless overridden with `visibility: "always"`), functional role, and
provenance deterministically.
`groups` is an optional string array on nodes and edges. A filter selects the
matching edges, their endpoints and explicitly grouped nodes; the AI must provide
all intermediate hops in each route group. Node membership alone never invents
an edge or a route. Limits are 300 nodes, 800 edges and 20 memberships per element.

Optional `clouds` gives logical placement of existing remote entities:

```json
[
  {
    "host": "cloud-node",
    "provider": "Example cloud",
    "region": "Asia Pacific",
    "direction": "south"
  }
]
```

Directions are north/south/east/west, with south as the default. Cloud and
external nodes float in a dedicated upper sky layer above the physical home and
remain stationary as you orbit the 3D scene; local physical hosts arrange in
stable flanking columns around the central home, with thin leader lines
tracking placed 3D machine anchors (unplaced hosts remain without room-center
leaders). Their distance does not imply geography or latency. Provider colors
supplement textual labels. Ordinary home records and remote locations are not
moved by this presentation.

The `asOf` field is the source's topology snapshot date. It is not live telemetry.
An older snapshot from the same source is rejected. Missing host/service bindings,
duplicate IDs and dangling edges fail the entire command. Source and date are
visible. Edge animation indicates direction only. The absence of a graph leaves
existing service ownership available and explicitly reports missing connections.
**供电** projects the existing circuit/channel records as a separate graph; it
does not assert live power, infer socket numbers or invent network connections.
React Flow renders the interactive graph; ELK orders services within hosts. The
platform owns projected anchors, panel avoidance and line paths. Dense/narrow views
retain reading size and expose a host selector instead of overlapping every panel.
Within the 3D home scene, orbit, zoom, and device-mode picking remain active:
hosts and devices can be hovered and clicked to focus the 3D camera and
highlight their graph card without opening an object-detail drawer, while
non-device furniture remains non-interactive.

Cyber view supports switching both between **网格视图** (compact Dashy-style icon
grid) and **列表视图** (icon + label list), and between **机器为实** (machines
flank the 3D spatial room while logical edges overlay them, with an optional
`对比拓扑外` dim overlay when filtering) and **拓扑为实** (logical topology +
isolation domains are the primary canvas while host identities appear as lightweight
virtual tags alongside an explicit `不在此拓扑中` membership list). Service nodes,
host headers and overview edge badges resolve icons first from an explicit `icon`
reference (either a built-in local icon key from `shared/icons.ts` /
`public/icons/services/` or an authenticated `/api/icons/<sha256>` entry in the
standalone local image asset library `data/icon-library/`), then by service
ID/label keywords, and finally fall back to vector category icons. Overview edges
render concise protocol icons and expand to full labels when hovered or focused.
Intra-host self-references (`source.host === target.host`) stay inside each host's
compact stratified architecture frame (`分层隔离图` / `服务清单` / `Mermaid`)
rather than looping across the 3D scene: boundary services (`ingress` / `dns` /
`mesh` dock on the top perimeter wall while `egress` docks on the bottom exit
wall of strict solid isolation domains), top-level user apps, background
infrastructure, and strict internal data middleware occupy separate nested
strata, and high-fanout downward streams (`>= 3`) share horizontal trunk buses
while upward feedback loops route cleanly along the left return rail. Multiple
cross-host edges sharing a collapsed overflow endpoint bundle cleanly, and hover
highlighting updates visual emphasis without replacing React Flow nodes, keeping
fast hover-and-click interactions responsive. Topology and host-architecture views
render `large`, `medium` (compact icon + label), and `small` (icon-only) node
tiers, hiding subordinate/quiet edges at rest and revealing them with a hover
label when pointing at either endpoint or host. Click any node to edit its
icon size (`大`/`中`/`小`), layer, boundary role, category, zone, topology
memberships, icon binding, or directed edges (`always`/`hover`/auto)
incrementally (`cyber.node.*`, `cyber.edge.*`, `cyber.zone.*`,
`cyber.taxonomy.upsert`), or configure custom zones/categories/topologies via
the in-app **域与分类** manager and MCP/WebMCP tools.

## Domain actions and compatibility

- `item.record`: complete new `asset` and `item` (entity or stock), optional
  `containerId` / `compartmentId`; creation and containment commit atomically.
- `item.photos`: `itemId` and `photos`, an array of up to eight authenticated
  `/api/uploads/<sha256>` references. Both entity and stock records support photos.
- `storage.configure`: existing `storage` fields, with optional `interior`.
- `storage.place`: existing fields; `slot` becomes optional and the server chooses
  a free logical slot. Optional `compartmentId` selects a leaf.
- `cyber.replace`: complete `graph` from the small contract above.
- `cyber.node.upsert` / `cyber.node.delete`: increment/rename or delete a single
  CyberView node (materializing `home.cyber` from services if absent; node
  deletion prunes incident edges atomically).
- `cyber.edge.upsert` / `cyber.edge.delete`: add/update or delete a directed
  route/dependency edge.
- `cyber.zone.upsert` / `cyber.zone.delete`: manage strict (`solid`) vs virtual
  (`dashed`) isolation zones (`hosts` / `groups` / explicit `node.zone`).
- `cyber.taxonomy.upsert`: register, merge, replace, or delete custom
  `categories` and `topologies` metadata.

An interior is `{root, parts}`. Each part has `id`, `name`, `kind: shelf|drawer`
and optional `split: {axis: x|y, ratio, first, second}`. Ratio is 0.08–0.92 and
child IDs refer to other parts. The graph must be one connected tree with unique
IDs. Attachments store an optional `compartmentId`; split/merge remapping is
server-owned. Physical compartments can contain multiple records; old slot
occupancy still prevents duplicate placements. The existing operation-ID,
revision and recovery rules apply to every action.

The example's browser-only endpoints are `/api/world-example/state` and
`/api/world-example/commands`, backed by `.cache/world-example/`. The example uses
the same command engine. A pending browser command also retains its destination
scope across reload and blocks writes into a different space until reconciled.
There is no second server, paid generation or external monitoring in this example.

Portable exports include photos as private file references, interiors and graph
records. Copy private photos separately when moving an installation, as with GLBs.
Review household topology and notes before sharing exports.
