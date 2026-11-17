# Agent and integration interface

The local service owns state. Both the UI and `npm run home` use this API; an
agent does not edit `state.json` directly. Domain identifiers are stable, placement
is parent-relative metres (Y up), and model assets are references independent of
inventory quantity. The runtime schema is available through `home schema`.

## Start and authenticate

Start `npm run dev` or build and `npm start`, or run via Docker (`docker compose up -d --build`).
By default the native Node process listens at `127.0.0.1:4100`; in the Docker
deployment ([compose.yaml](../compose.yaml)) it binds `0.0.0.0:4100` with
`DASH_ALLOW_REMOTE_PEERS=1` and explicit non-wildcard `DASH_ALLOWED_HOSTS` so
LAN, Tailscale and containerized services can call `/mcp` and `/api/*` remotely.
The first server start creates `data/private/agent-token` with mode 0600. The CLI
reads it internally. An integration can load this file and send `Authorization:
Bearer TOKEN`, or the CLI can read `HOMEDASH_TOKEN` from its environment. Never
include its value in prompts, logs, public templates or screenshots. The agent
capability permits state/inventory changes and event ingestion, not provider-key
settings, photo submission or paid generation HTTP writes. The local Lux3D CLI is
a separate generation capability for explicitly authorized use.

For authorized object modeling, `lux3d submit-image --image` accepts 1–32 ordered
file paths and journals the set before one SDK create. The first view is primary;
the current batch's live-call allowance still applies. See
the model preview for orientation and physical size before placement.
Browser-only `POST /api/generations` accepts exactly one of legacy
`uploadId` or `uploadIds` (1–32); the integration token does not gain paid-generation
authority. Reopening a generation returns `uploadId` plus ordered `uploadIds`.

This application strictly separates public visitor showcase access from owner
administration. Unauthenticated visitors on `/` receive only the stripped
`/api/guest/state` showcase and whitelisted `/api/guest/uploads/:id` media,
while admin APIs, `/mcp`, `/inspector.html`, `/generated/manifest.json`, and
unreferenced local models return `403`. Owners sign in at `/admin/login` using
`DASH_ADMIN_KEY` or the auto-generated `0600` key in `data/private/admin-token`
(independent of `data/private/agent-token`); even `127.0.0.1` loopback requires
admin login before opening management surfaces.

Configure the server's exact Tailscale IP/names or `DASH_PUBLIC_ORIGINS` (exact
reverse-proxy `http://`/`https://` origins without paths or wildcards) as
described in README. Browser Host/Origin checks enforce those exact names/origins
alongside loopback. Forwarded Host headers are not trusted. The CLI also accepts
an explicitly chosen Tailscale IP or full `.ts.net` hostname, and refuses redirects:

```bash
npm run home -- --url http://100.90.10.20:4100 state
```

A remote agent still needs the integration token provisioned privately via
`HOMEDASH_TOKEN` or its local token file. Network membership alone does not replace
the token for direct API commands/events. Do not expose a wildcard listener or
publish the credential to make a remote connection work.

## Runnable inventory example

This creates a command file with a fresh timestamp and current revision. The file
contains no credential. It works with either shipped template and the private
owner seed, all of which have the illustrative `cat-litter` zone.

```bash
node --input-type=module <<'JS'
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const state = JSON.parse(execFileSync('node', ['--import', 'tsx', 'scripts/home.ts', 'state'], { encoding: 'utf8' }));
mkdirSync('data/commands', { recursive: true });
writeFileSync('data/commands/add-litter.json', JSON.stringify({
  operationId: randomUUID(),
  expectedRevision: state.revision,
  issuedAt: new Date().toISOString(),
  action: { type: 'stock.adjust', stockId: 'cat-litter', delta: 1 }
}, null, 2), { mode: 0o600 });
JS
npm run home -- command data/commands/add-litter.json
# Repeating THIS FILE returns the original receipt; it does not increment again.
npm run home -- command data/commands/add-litter.json
```

Every command requires `operationId` (UUID), `expectedRevision`, `issuedAt` and
`action`. Commands older than 24 hours or more than 60 seconds in the future are
rejected. Receipt retention is 24 hours; expired commands remain invalid rather
than becoming new effects. An operation ID reused for different input fails.

| Response/outcome                | Agent action                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------- |
| Success                         | Keep receipt: operation ID, resulting revision, actor and result                  |
| Lost response / unknown outcome | Retry the exact file/body/ID first                                                |
| Revision conflict               | Read current state, review intent, then create a new command if still appropriate |
| Validation failure              | Correct the data; no part of the command was committed                            |
| Expired operation               | Read activity/current state and reconcile before a new command                    |

The browser keeps an unconfirmed command in sessionStorage and offers a retry
using that exact body even after reload. It never silently assigns a fresh ID to
an operation with unknown outcome. Pending actions block different new edits.

## Available actions

The additive text/photo, cabinet-interior and HomeLab graph commands are documented
in [world views](world-views.md#domain-actions-and-compatibility). They use this same
revisioned command surface. `cyber.replace` accepts the small nodes/edges snapshot;
it does not execute monitoring or network operations.

| Action                                    | Payload after `type`                                                                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout.commit`                           | Optional complete `rooms`, `additions: [{entity, asset}]`, `placements: [{kind, id, locationId, position, rotation, placementConfirmed, asset?}]`                                              |
| `stock.adjust`                            | `stockId`, signed nonzero `delta`; range 0–100000 enforced                                                                                                                                     |
| `stock.transfer`                          | `fromId`, `toId`, positive `quantity`; same SKU/unit, both balances atomic                                                                                                                     |
| `stock.create`                            | Complete `stock` with location, quantity and model asset                                                                                                                                       |
| `entity.place`                            | `entityId`, `locationId`, `[x,y,z] position`, `rotation` radians                                                                                                                               |
| `entity.describe`                         | `entityId`, at least one of `name`, `description`, `visibility` (`always` or `editing`); preserves notes and identity                                                                          |
| `entity.note`                             | `entityId`, `notes`                                                                                                                                                                            |
| `entity.create`                           | Complete independent `entity`                                                                                                                                                                  |
| `object.capture`                          | Complete `asset` + `entity` committed together                                                                                                                                                 |
| `stock.asset`                             | `stockId`, complete `asset`; quantity is preserved                                                                                                                                             |
| `entity.asset`                            | `entityId`, existing `assetId`                                                                                                                                                                 |
| `asset.upsert`                            | Complete local `asset`                                                                                                                                                                         |
| `room.update`                             | Complete existing `room`                                                                                                                                                                       |
| `service.upsert`                          | Complete `service`, including owning `entityId`, optional `icon` (built-in key or `/api/icons/<sha256>`), and optional architectural hints (`size`, `layer`, `boundary`, `category`, `zone`, `groups`) |
| `cyber.replace`                           | Complete validated CyberView graph (`nodes`, `edges`, `clouds`, optional `zones`, `categories`, `topologies`)                                                                                  |
| `cyber.node.upsert` / `cyber.node.delete` | Incremental CyberView node create/update/rename or delete (prunes incident edges atomically; supports `size: 'large'|'medium'|'small'`)                                                        |
| `cyber.edge.upsert` / `cyber.edge.delete` | Incremental CyberView edge create/update/rename or delete (supports `visibility: 'always'|'hover'`)                                                                                           |
| `cyber.zone.upsert` / `cyber.zone.delete` | Manage custom strict/virtual isolation zones (renaming remaps references; deleting clears dangling references)                                                                                 |
| `cyber.taxonomy.upsert`                   | Merge, replace, or delete custom `categories` (`label`, `shortLabel`, `color`, `defaultLayer`, `order`) and `topologies` metadata                                                              |
| `electrical.upsert`                       | Complete `circuit` linking a controller entity, metering mode and named load channels                                                                                                          |
| `hotspot.upsert`                          | Interactive game-style hotspot (`id`, `label`, `audience`, `anchor`, `visual`, `effect`: `envelope`, `album`, `link`, `iframe`, `spotlight`, `variant`)                                        |
| `hotspot.delete`                          | Delete hotspot by `hotspotId`                                                                                                                                                                  |
| `entity.guest`                            | Configure guest-mode entity visibility (`show`, `backdrop`, `hide`) and optional public `summary` (`entityId`, `guest`)                                                                        |
| `incident.ack`                            | `incidentId`; only source recovery resolves it                                                                                                                                                 |
| `template.import`                         | Complete validated `template`; previous home backed up automatically                                                                                                                           |

Use `shared/domain.ts` / the JSON schema for full fields and limits. Import
validates unique IDs, references, entity lifecycle, remote/home scope and centre
coordinates within rooms. Asset dimensions are approximate, not collision or
measurement guarantees. Room creation/removal can use a complete `rooms` list in
`layout.commit` together with any required placements; all remaining records must
have valid locations. Bulk object removal uses export/edit/import JSON. The UI
edits room bounds and optional floor polygons.

An asset may retain its authored `kind` and supply a primary local GLB `url` for
every viewing distance. `detailUrl` optionally overrides it at close range.
Optional `variant: {group, label}` groups visual appearances; the viewer offers
matching assets through `entity.asset`. Switching preserves the entity's other
fields and services and does not control or observe a physical device. Keep
variant geometry, dimensions and orientation consistent when representing one
object's on/off appearances.

A room's optional `footprint` is an ordered array of 3–40 local `[x,z]` vertices,
inside its `size` rectangle. It must have nonzero area and edges and cannot
self-intersect. Ordinary entity/stock centres must fall inside the polygon
(boundary included). Structural kinds may occupy the wall return outside the
floor polygon, while remaining inside room bounds. This does not validate full
furniture footprints or collisions. UI room resizing scales the polygon; API
callers send explicit complete room values. `entity.visibility: "editing"` keeps
a record selectable in the editor/list while omitting its mesh from browse mode.
The catalog assigns this visibility to new `window-marker`, `door-marker` and
`wall-return` records. Marker positions and polygon vertices are independent edits.

`layout.commit` is the edit-mode transaction: all spatial changes validate and
commit together against the draft's base revision. A private
`before-layout-vREVISION.json` backup precedes commit. Additions accept independent
active home objects, devices and hosts with authored asset kinds only. A placement's optional dimension-adjusted asset must have a
new ID so shared appearances are never silently resized. Stock rotation defaults
to zero when omitted in older records. The authoritative kind list is
`furnitureKinds`, `deviceKinds` and `structuralKinds` in `shared/domain.ts`; `shared/layout.ts` owns display names and
default estimated dimensions. Besides basic furniture, it includes `gaming-chair`,
`metal-shelf`, `mini-fridge`, `drawer-cabinet`, `bedside-cabinet`,
`display-cabinet`, `glass-cabinet`, `kitchen-counter`, `sliding-door`, `keyboard`,
`mouse`, `microphone`, `mug`, `headphones`, `fan`, `beanbag`, `bench` and
`litter-tray`, `round-storage-table`, `armchair`, `wall-display`, `pegboard` and
`privacy-screen`. A 0.4 m privacy-screen record renders one panel. `wall-display`
has a rear mounting bracket and no floor/desk stand. `chair` means an ordinary chair. Authored geometry fits the
recorded width/height/depth with a centred footprint and floor-based pivot.
Authored chairs face local -Z; cabinets and screens face +Z. `asset.front` may override
the inspection direction. Camera orientation never changes the saved heading.
Kitchen height includes the tap. Desktop accessories need an explicit Y position
at their supporting surface and do not follow a moved table automatically.
No deletion, quantity, note, service or observation mutation is part of this
command. Inferred placements use `placementConfirmed: false`; explicit manual
placement can use true, which is retained only for a physical room. Logical
scope, retired-object and room-bound validation still apply. Retain the command's
operation ID/body when its response is uncertain; conflicts require reviewing
the latest state and never silently change the draft's base revision.

An exported home contains service URLs and personal notes; review it before
sharing. Export omits observations, runtime receipts and keys. GLBs are separate
local files. Example templates use synthetic names and paths only.

## Electrical relationships

Optional `home.electricalCircuits` records physical supply/control connections.
`electrical.upsert` takes a `circuit` with `id`, `name`, `controllerEntityId`,
`metering` (`none`, `aggregate`, `per-outlet`), `channels`, `source` and `asOf`.
Each channel has `id`, `name`, `entityIds` and an optional physical `outlet`
number. Omit that number until verified; channel IDs are stable logical labels.
An aggregate meter has one channel shared by all loads; a per-outlet strip has
separate channels. A smart switch uses `none`. Controllers must be active home
plugs, smart strips or switches; loads must be active home entities with only
one supply channel. Controller/load cycles and duplicate sockets are rejected.

These records preserve wiring intent through layout edits, export and restart.
They contain no live electrical readings or switch states and perform no device
control. Selection details expose these relationships without adding persistent
scene overlays. Device asset kinds live in `deviceKinds` in `shared/domain.ts`;
they remain independent of provider integrations.

## External notifications

An adapter (Uptime Kuma, n8n, Home Assistant, a host-monitoring tool, etc.) maps its
own payload into this event shape and POSTs `/api/events`, or runs `home event
FILE.json`. Native vendor payloads are not assumed to match this format.

```json
{
  "schemaVersion": 1,
  "eventId": "unique-source-delivery-id",
  "source": "uptime-adapter",
  "subjectId": "studio-mini",
  "condition": "availability",
  "status": "open",
  "severity": "warning",
  "message": "Service did not answer its configured health check.",
  "observedAt": "REPLACE_WITH_CURRENT_ISO_TIME",
  "ttlSeconds": 300
}
```

Replace subject ID with an existing entity/service and use the source observation
time. Event IDs deduplicate per source. Reusing an ID with another body fails;
equal/older observations cannot undo a newer one. Conditions are `availability`,
`maintenance`, `power`; status is `open` or `resolved`. TTL is 10–86400 seconds.
Ingestion accepts a 24-hour window with at most 60 seconds of future skew.
An expired observation displays stale, not healthy. An unresolved incident is
retained for review even after the latest observation becomes stale. A service
incident locates its owning physical/logical host. Missing/retired subjects go
to the unmapped list. `demo.` is reserved for explicitly labelled local demos.

No event executes power changes, host updates or shell commands. Those actions
belong to a separately authorized, constrained operations system.

## HTTP surface

| Method / path                                                     | Use                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/session`                                                | Public: returns `{ role: "guest" | "admin", csrfToken? }`                                                                                                                                    |
| `POST /api/admin/login`, `POST /api/admin/logout`                 | Authenticate admin key (`DASH_ADMIN_KEY` / `data/private/admin-token`) with rate limiting and persistent `HttpOnly` cookie session, or clear session                                        |
| `GET /api/guest/state`, `GET /api/guest/stream`                   | Public projected showcase snapshot/SSE (`stocks`, `services`, `electrical`, `cyber`, logical rooms, notes, and `hide` entities stripped)                                                     |
| `GET /api/guest/uploads/:id`                                      | Public uploaded photo only when referenced by a visible guest hotspot or visible guest entity                                                                                               |
| `GET /api/state`                                                  | Admin/agent: current versioned dashboard without private dedup tables (`403` for visitors)                                                                                                   |
| `GET /api/command-schema`                                         | Machine-readable command JSON schema                                                                                                                                                        |
| `POST /api/commands`                                              | Validated domain mutation                                                                                                                                                                   |
| `POST /api/events`                                                | Authenticated external notification                                                                                                                                                         |
| `GET /api/events/stream`                                          | SSE full snapshots; ignore older revisions                                                                                                                                                  |
| `GET /api/export`, `/api/templates`                               | Portable home and synthetic templates                                                                                                                                                       |
| `GET /api/icons`                                                  | List built-in local service icon keys and uploaded entries in the standalone local icon library (`data/icon-library/`)                                                                      |
| `POST /api/icons`                                                 | Browser or agent: upload one multipart `image` (PNG/JPEG/WebP/GIF/SVG, 4 MiB maximum); normalized to stripped PNG and deduplicated by SHA-256                                               |
| `GET /api/icons/:id`                                              | Authenticated standalone local icon image (`data/icon-library/<sha256>.png`)                                                                                                                |
| `GET /api/layout-reference`, `/api/layout-reference/images/:name` | Authenticated private reference index and four allowlisted photo crops; never public assets                                                                                                 |
| `POST /mcp` (Streamable HTTP MCP)                                 | Browser or agent: stateless MCP JSON-RPC endpoint exposing existing dashboard state, icons, commands and events directly as discoverable tools & resources (`tools/list`, `resources/list`) |
| `GET /api/providers`                                              | Non-secret configured status                                                                                                                                                                |
| `PUT /api/providers/lux3d`                                        | Browser only: save a new credential connection                                                                                                                                              |
| `POST /api/uploads`                                               | Browser only: one multipart `image` (12 MiB maximum)                                                                                                                                        |
| `GET /api/generations`                                            | Sanitized job summaries, local asset references                                                                                                                                             |
| `POST /api/generations`                                           | Browser only: explicit image submission                                                                                                                                                     |
| `POST /api/generations/:name/refresh`                             | Query and download the existing task                                                                                                                                                        |
| `POST /api/generations/:name/attach`                              | Bind an explicitly confirmed task ID                                                                                                                                                        |
| `GET /api/generation-history?name=...`                            | Browser only: history using the pinned connection                                                                                                                                           |

Unauthenticated visitors are denied (`403`) on all non-guest APIs, `/mcp`,
`/inspector.html`, `/demo/service`, `/generated/manifest.json`,
`/icons/services/*`, and models not referenced by visible guest assets. Signing in
at `/admin/login` sets an `HttpOnly` `SameSite=Lax` cookie plus a per-session
`X-Session-Token` write header. Provider settings do not return keys.

## MCP & Browser WebMCP discovery

Instead of requiring external AI agents to memorize REST paths, action unions or
envelope boilerplate, the web server directly exposes a Streamable HTTP MCP endpoint
at `/mcp` (accepting the same loopback/Tailscale Host+Origin rules and
`Authorization: Bearer <token>` or local browser session authentication), and when
opened in a WebMCP-enabled browser (`document.modelContext` /
`navigator.modelContext`) progressively registers the exact same tool catalog onto
the active page session:

- Read & catalog tools: `get_home_state`, `inspect_cyber_architecture` (resolved layers, classification provenance, custom zones, registries, host Mermaid), `list_icons`, `list_imported_models`
- HomeLab, showcase & asset tools: `upsert_service`, `replace_cyber_graph`, `upsert_cyber_node`, `delete_cyber_node`, `upsert_cyber_edge`, `delete_cyber_edge`, `upsert_cyber_zone`, `delete_cyber_zone`, `configure_cyber_taxonomy`, `upsert_electrical_circuit`, `upsert_hotspot`, `delete_hotspot`, `set_entity_guest`, `upload_icon`
- Household & monitoring tools: `record_item`, `adjust_stock`, `acknowledge_incident`, `ingest_event` (`agent` authority), and `run_domain_command` (covers every action in `shared/domain.ts`)
- Resources (server `/mcp`): `homelab://state`, `homelab://icons`, `homelab://cyber`, `homelab://cyber/architecture`

Browser WebMCP tools route automatically to `/api/world-example/*` when previewing
the isolated example world instead of mutating owner data.

Write tools auto-fill `operationId`, `issuedAt` and default `expectedRevision` from
the latest state snapshot when omitted, while accepting caller-supplied values for
strict optimistic concurrency or idempotent retries. Uploads are normalized to JPEG,
metadata stripped, longest dimension <=1600, maximum decoded input 40M pixels.
Unsupported formats fail without creating a generation. HEIC support depends on
the installed Sharp decoder; JPEG/PNG/WebP are the reliable input formats.

## Extending providers and AI capabilities

`server/providers.ts` selects the backend and resolves credentials; `Jobs` owns
pre-submit intent, deduplication, query state and downloads. Its small `Api`
interface is the current task adapter seam. The Lux3D adapter uses verified SDK
methods, while the explicit fixture adapter exercises the same lifecycle offline.
A new 3D provider implements this seam and maps its statuses/outputs, adds its own
validated parameter schema/provider identifier, and receives lifecycle tests. The
current parameter form is intentionally Lux3D-specific. This is a replaceable
adapter boundary, not a general dynamic plugin loader.

Never change a job's provider/connection during recovery or automatically fail
over a paid creation. Domain objects reference local GLB asset IDs and require no
provider methods. Keep language/voice agents in separate capabilities: they emit
the same validated domain commands instead of becoming dependencies of the
Three.js scene. Preserve original operation IDs on network retry and keep
credential injection outside the model's context.

## Task focus, storage and assisted placement

The spatial scene is a projection of the same records used by agents. Browser
`browse`, `devices` and `inventory` tasks change picking and presentation only.
Selection approaches the installation from its front with the current viewing
elevation, room context and substantial support. Directionless objects such as round
tables retain the current approach bearing. The explicit front-view control faces the local front. Lights are an
optional display layer, not deleted records. These transient views do not mutate
the home.

Optional `asset.detailUrl` references a reviewed local GLB for close inspection;
`modelRotation` rotates source geometry about Y, and `front` is the local front
angle in radians (default -Z for chairs, +Z otherwise). Optional `stand: "base" | "arm"`
controls monitor supports; `glassPanels: ("front" | "left" | "right")[]` describes
local chassis faces. `lightTilt` is a lamp head elevation in radians, positive up.
These fields describe geometry, never live device state. Existing authored kinds retain
semantic roles even with a detailed GLB. New imported tables/wardrobes can choose
these roles in the capture panel. Quantities and identity never live in a mesh.

Optional entity/stock `attachment` is `{parentId, kind: "surface" | "storage" | "mount",
slot?}`. Stored contents share their container's room and are accessed through
its logical grid; positions remain room-relative for older clients. Explicit
relationships follow parent moves/rotations, including nested storage. Ordinary
free placement detaches the moved item. Layout previews derive child movement;
`layout.commit` derives it again and does not require child placements. These
rules supersede the earlier note that all desktop accessories are independent.
Older records without attachments remain independent until explicitly placed.

| Action              | Fields and result                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage.configure` | `storage: {entityId, columns, rows}`; each 1–8. Logical slots, not measured compartments. Defaults to 4×4 for recognized storage furniture. Shrinking across occupied slots fails.                                                                                                    |
| `storage.place`     | `itemId`, `containerId`, zero-based `slot`; moves one entity or entire stock balance atomically. Occupied slots, cycles, remote/retired objects and invalid rooms fail.                                                                                                               |
| `surface.place`     | `itemId`, `supportId`, optional support-local `preferred: [x,z]` in metres, `quarterTurn` (default false). The deterministic solver chooses the nearest free candidate on a bounded grid. Receipt includes resulting position/rotation.                                               |
| `item.release`      | `itemId`, physical `locationId`; detaches and finds a free floor footprint, or fails without changing state.                                                                                                                                                                          |
| `object.model`      | `entityId`, new `asset`; atomically replaces the appearance association and preserves entity identity, notes, services and placement. Use a new asset ID.                                                                                                                             |
| `object.mount`      | `entityId`, `parentId`; preserves the current pose and links an active physical entity to a support/arm in the same room. Parent movement carries this elevation/rotation offset. Rejects cycles and stored ancestors; this deliberate installation does not run the tabletop solver. |
| `object.capture`    | Existing fields plus optional `supportId`; creation and collision-checked surface placement commit together.                                                                                                                                                                          |

Surface checks use recorded rotated bounds, height overlap and a 1.5 cm placement
margin. Stock footprint includes its existing capped visible arrangement. A full
surface returns an error without rearranging other objects. Quantity/asset changes
cannot overflow an explicitly linked support. No load capacity or physics is
inferred. The preview is advisory: commit checks the expected revision and current
records again. Retry the same operation ID after an uncertain response.

`POST /api/assets/import` accepts a browser-authenticated multipart `model` GLB
(up to 64 MiB); external resource references and truncated files are rejected.
Content hashes deduplicate bytes; `GET /api/assets/imports` lists the local library.
An optional multipart `source` JSON field contains `platform` (up to 80 chars),
`url` (public HTTP(S) model-page reference, up to 2048 chars, no credentials),
`author` (up to 160 chars) and `license` (up to 300 chars). Fields are optional;
omit unknown values. Metadata is validated before files are written. Different
source records for identical bytes have distinct catalog IDs but share the GLB.
The response and library entries include `source` when provided. Copy it to the
optional `asset.source` field when committing a model. It survives template
export/import. Replacing a model must use its own source, not the previous model's.
Files persist without associating or creating a domain object until a command
commits. Both imports and Lux3D results use the capture panel's calibration and
placement. API generation retains its existing explicit paid authorization path.
