# Verified Lux3D integration

Checked 2026-11-12 (Asia/Shanghai) against the live official site, npm metadata,
installed declarations and JavaScript implementation.
Multi-view behavior was rechecked on 2026-11-15 against the installed pinned SDK
and [current developer documentation](https://3d.aholo.cn/docs). That documentation
and transport check did not itself perform a live generation or change the SDK
version. A later owner-authorized batch on the same date verified live multi-view
creation and download for three objects, recorded below.

## Sources and versions

- [TypeScript SDK](https://labs.aholo3d.cn/api-docs/sdk/typescript)
- [OpenAPI JSON](https://labs.aholo3d.cn/api-docs/openapi.json)
- [Release notes](https://labs.aholo3d.cn/api-docs/release-notes)
- [MCP](https://labs.aholo3d.cn/api-docs/mcp)
- [Official source](https://github.com/manycoretech/aholo-spatial-sdk/tree/main/typescript)
- npm `@manycore/aholo-sdk-lux3d`: **1.9.0**, pinned here.
- Resolved SDK core: **1.3.0**, recorded in the lockfile.
- Retrieved OpenAPI SHA-256:
  `2e57dd09aa26c09ec5c40df7ad1da23098c897f73c97f03c16256badf35e1a58`.

The SDK uses `AHOLO_API_KEY`, `region: 'cn'`, and
`https://api.aholo3d.cn`. Authorization is the raw API key, without a Bearer
prefix. We let the official SDK apply this header. The older Python Skill page
uses different environment names; those names are not used by this project.
MCP is a reference, not a required service: adding a local MCP process would
not improve this minimal CLI/browser boundary.

## Verified methods

| SDK method | Wire operation | Return |
| --- | --- | --- |
| `createLux3dClient({ apiKey, region, timeoutMs })` | Construct official client | `Lux3dClient` |
| `client.textTo3d.create(params)` | `POST /lux3d/v1/generate/text-to-3d/task/create` | Numeric task ID directly |
| `client.imgTo3d.create({ img, ...params })` | `POST /lux3d/v1/generate/img-to-3d/task/create` | Numeric task ID directly |
| `client.imgTo3d.createFromFile(path, params)` | Reads local file into Data URL, then `imgTo3d.create` | Numeric task ID directly |
| `client.imgTo3d.createFromFiles(paths, params)` | Encodes local views into `imgs`, then `imgTo3d.create` | Numeric task ID directly |
| `client.tasks.retrieve(id)` | `GET /lux3d/v1/generate/task/get?taskid=...` | `{ taskId, bizId?, status, outputs }` |
| `client.tasks.list({ page, pageSize })` | `GET /lux3d/v1/generate/task/list?page=...&pagesize=...` | `{ items?, total?, page?, pageSize? }` |
| `client.tasks.waitFor(id, options)` | SDK polling helper | Final result or polling error |

We intentionally poll with `retrieve`, writing every observation to disk; this
allows process restart and preserves the last known state. There is no documented
numeric progress percentage. Task IDs must fit JavaScript safe integers.

`textTo3d.create` accepts `prompt`, optional `style`, `version`, `faceCount`,
`outputFormat`, `enablePbr`, `aiPredictSize`, and an optional reference `img` URL.
The CLI exposes text creation and a separate `submit-image` command. Zod rejects unknown fields rather
than silently dropping a misspelled option. Its 4,000-character prompt limit is
a local guard, not a claimed service limit.

The photo-led product design was additionally checked against the official
TypeScript guide and installed `resources/img-to-3d.js` / `.d.ts` on 2026-11-12.
`img` and `imgs` are mutually exclusive; the SDK validates 1–32 entries for `imgs`.
The guide includes a G1 multi-view example and a G1-Turbo single local-file example.
The installed local-file helpers encode Data URLs and do not invoke the separate
Asset upload API. Generated OpenAPI comments instead recommend uploading files
to Asset and supplying the URL. Preserve this documented difference: use the
official helper's actual signature. The image path was then verified live with
task `6511017`: G1-Turbo from a rendered fixture image, status 3, downloaded and
renderable GLB. The 2026-11-15 installed SDK transport check verifies the current
`/img-to-3d/` endpoint. Earlier notes recorded `/image-to-3d/`; that assertion was
inside a transport deliberately simulating failure, so the mismatch could be
mistaken for the expected uncertainty. Tests now assert captured requests outside
the failing transport and include successful single- and multi-view submissions.
This corrects the offline evidence; it does not establish fresh live compatibility.

The SDK helper infers MIME type from filename and reads bytes; application-side
upload validation uses Sharp with a 12 MiB input/output byte limit, 40M decoded-pixel
limit, longest side 1600 and metadata stripping. Opaque images use JPEG; images
with non-opaque alpha preserve transparency in PNG. Fully opaque RGBA inputs
retain JPEG normalization and its previous digest. Legacy `.jpg` upload IDs remain valid.
JPEG/PNG/WebP
are supported; HEIC depends on the installed decoder. Helper support is not evidence of accurate physical
dimensions or full-room reconstruction. Treat `aiPredictSize` as an estimate.

Both G1 and G1-Turbo accept 1–32 views. The first image should be the clearest,
most complete view of the same object; keep structure, lighting and background
consistent. The optional four-view API returns front three-quarter, opposite
three-quarter, side and rear views, not a top view. Current docs recommend Asset
upload for URL inputs while the installed SDK's local-file helpers encode Data
URLs; the application continues using those verified helpers.

The shared service and CLI now journal all normalized views before exactly one
`createFromFiles` call. Ordered image digests, parameters and the pinned connection
form the multi-view fingerprint. One-image sets retain the original fingerprint
and `createFromFile` behavior. `input` / public `uploadId` remain the primary view;
additive `inputs` / `uploadIds` retain all views. Invalid or missing inputs fail
before creation, and uncertain/terminal tasks are reused rather than replayed.

The current public CN documentation lists `https://api.aholo.cn`; the installed
core 1.3.0 still defaults to `https://api.aholo3d.cn`. No base URL override or SDK
upgrade was made. Keep this distinction until an authorized live task verifies
the configured route; do not silently change the route of existing jobs.

The SDK/OpenAPI allow omitted version while some prose still says required.
We explicitly send `G1-Turbo` or `G1` to avoid this ambiguity. Face count accepts
10,000–300,000. G1-Turbo supports requested ZIP/GLB/PLY; G1 returns ZIP/GLB and
optionally PLY. Output formats are normalized before fingerprinting.

`TaskOutput` only guarantees optional `content`: a URL or a placeholder such as
`NOT_REQUESTED`. It does **not** provide a documented `format`, `url`, or `type`
property. The downloader skips placeholders and identifies files by their bytes.
Success is `3`; `4` and `6` are terminal errors; `0` and `1` are pending. Remote
history filters exclude `6`, but result items may contain it. Unknown statuses
are rejected until their semantics are verified.

## Retry and recovery facts

Inspection of core `dist/http.js` shows exactly one `fetchImpl` invocation and
no retry loop. `AholoClientConfig` has no `maxRetries`/`retry` option. Do not invent
one on upgrade. The current OpenAPI exposes no create idempotency key. The local
intent journal and file lock prevent automatic replays within this checkout;
they cannot prove server-side exactly-once execution.

The API history schema contains IDs, statuses, `created` and `lastModified`
(Unix milliseconds), not the original prompt. Recovery by ID is an operator
decision. Preserve an ambiguous intent even after an HTTP error; the safest
default is to reconcile before paying again.

Result URLs expire after about two hours. `download` refreshes task detail,
streams files without an Authorization header, writes partial files, validates
GLB headers/JSON/self-contained resources, records SHA-256 and byte length,
then publishes a manifest of local paths. No signed CDN URL enters the manifest.
Three.js loading in the browser is a further validation of actual renderability.

There is no verified price/balance method in this integration. The live history
response unexpectedly included `consumedCredits: 13`, `taskType: "text-to-3d"`
and `version: "g1-turbo"` for the initial task; these fields are absent from the
installed `TaskListItem` declarations. We record that observation, without relying
on those undocumented fields for logic or treating it as remaining balance.
Any future paid workflow should declare its task count and stop conditions before use.

The image smoke task history reported `consumedCredits: 1`. Exactly one new image
task was created for this delivery; replay reused it. This is observed consumption,
not a price guarantee. Local fixture tasks never call the upstream API.

## Live multi-view object batch (2026-11-15)

The owner authorized three new image-to-3D creates, one each for M1, M4 and ASUS
G700. Tasks `8018333`, `8018192` and `8018601` all returned success `3` and
self-contained downloadable GLBs using G1-Turbo, PBR, a requested 100,000 faces,
GLB output and `aiPredictSize: false`. They used 3, 3 and 4 ordered prepared views
respectively. Requested face count is a target: the returned meshes had 43,916,
129,778 and 21,008 triangles. No automatic new create or paid conversion followed.
The M1 transfer timeout was recovered by downloading the same task with a longer
transfer timeout. Read-only history reported one consumed credit for each task;
these undocumented observations are not future price quotes.

The original provider files and journals are preserved. Local calibrated models,
including two G700 material/texture appearances sharing geometry, are recorded in
the local modeling records. This establishes working live multi-view
creation and download for this batch, not general fidelity or CAD accuracy.

## Direct text fallback acceptance (2026-11-15)

The owner requested one live text-to-3D test for a generic corrugated-cardboard
cat bowl/scratcher. Task `8022226` used the existing journaled CLI `submit` and
installed SDK `textTo3d.create`, with an explicit photorealistic style,
G1-Turbo, 100,000 target faces, PBR GLB and `aiPredictSize: false`. It accepted no
`img`, `imgs`, uploads or prepared views. The task succeeded, downloaded a
12,901,808-byte self-contained GLB, and history reported 13 consumed credits.
The observed history count grew from 7 to 8; no second create or paid
image/material/conversion was used. The original file is preserved; local geometry
calibration and scalar paper material adjustments produce the home asset.

The skill selects this route when image-generation and usable image-plus-vision
routes are unavailable, or when the owner explicitly requests a text-only test.
This acceptance exercised the latter condition; vision remained available for
final QA, and no unavailable-tool simulation is claimed. The skill also documents
structural checks and explicitly unverified appearance when vision is absent.
The 12 existing text lifecycle tests using the official SDK's injected transport
passed offline. `submit` itself has no fixture option; an ordinary offline test
must not be replaced by a new live text request.
