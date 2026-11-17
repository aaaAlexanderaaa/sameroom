import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  stat,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import sharp from "sharp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../server/app.js";
import { Providers } from "../server/providers.js";
import type { NetworkAccess } from "../server/network.js";

async function fixture(
  t: { after: (f: () => Promise<void>) => void },
  access: NetworkAccess = {},
) {
  const root = await mkdtemp(join(tmpdir(), "home-http-"));
  const { app, agentToken, providers } = await createApp(root, access);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    await rm(root, { recursive: true, force: true });
  });
  const boot = await fetch(url + "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key: (await readFile(join(root, "data/private/admin-token"), "utf8")).trim(),
    }),
  });
  assert.equal(boot.status, 200);
  const { csrfToken } = (await boot.json()) as { csrfToken: string };
  const headers = {
    cookie: boot.headers.get("set-cookie")!.split(";")[0],
    "x-session-token": csrfToken,
    "content-type": "application/json",
  };
  return {
    root,
    providers,
    url,
    headers,
    agentHeaders: {
      authorization: "Bearer " + agentToken,
      "content-type": "application/json",
    },
  };
}
test("HTTP requires local host/origin and browser write token; agent can change inventory but not provider credentials", async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(f.url + "/api/state")).status, 403);
  assert.equal(
    await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        f.url + "/api/guest/state",
        { headers: { Host: "attacker.invalid" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    }),
    403,
  );
  assert.equal(
    (
      await fetch(f.url + "/api/state", {
        headers: { ...f.headers, origin: "http://attacker.invalid" },
      })
    ).status,
    403,
  );
  const input = {
    operationId: randomUUID(),
    expectedRevision: 0,
    issuedAt: new Date().toISOString(),
    action: { type: "stock.adjust", stockId: "cat-litter", delta: 1 },
  };
  assert.equal(
    (
      await fetch(f.url + "/api/commands", {
        method: "POST",
        headers: {
          cookie: f.headers.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      })
    ).status,
    403,
  );
  const send = () =>
    fetch(f.url + "/api/commands", {
      method: "POST",
      headers: f.agentHeaders,
      body: JSON.stringify(input),
    });
  const first = await send();
  assert.equal(first.status, 200);
  const receipt = await first.json();
  assert.equal(receipt.actor, "agent");
  assert.deepEqual(await (await send()).json(), receipt);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const file = join(f.root, "command.json");
  await writeFile(file, JSON.stringify(input));
  const cli = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "scripts/home.ts", "--url", f.url, "command", file],
    {
      env: {
        ...process.env,
        HOMEDASH_TOKEN: f.agentHeaders.authorization.slice(7),
      },
    },
  );
  assert.deepEqual(JSON.parse(cli.stdout), receipt);

  assert.equal(
    (
      await fetch(f.url + "/api/providers/lux3d", {
        method: "PUT",
        headers: f.agentHeaders,
        body: JSON.stringify({ key: "synthetic-key" }),
      })
    ).status,
    403,
  );
  const snapshot = await (
    await fetch(f.url + "/api/state", { headers: f.headers })
  ).json();
  assert.equal(snapshot.home.stocks[0].quantity, 4);
  assert.equal(snapshot.receipts, undefined);
});
test("provider secrets persist with restricted permissions and never appear in browser API/export", async (t) => {
  const f = await fixture(t);
  const configured = await fetch(f.url + "/api/providers/lux3d", {
    method: "PUT",
    headers: f.headers,
    body: JSON.stringify({ key: "synthetic-provider-secret" }),
  });
  assert.equal(configured.status, 200);
  const connection = (await configured.json()).connectionId;
  assert.equal(
    (await stat(join(f.root, "data/private/providers.json"))).mode & 0o777,
    0o600,
  );
  const restarted = new Providers(f.root);
  await restarted.init();
  assert.equal(restarted.describe().connectionId, connection);
  assert.equal(restarted.describe().configured, true);
  for (const path of [
    "/api/providers",
    "/api/state",
    "/api/export",
    "/api/generations",
    "/api/command-schema",
  ]) {
    const response = await fetch(f.url + path, { headers: f.headers });
    assert.equal(response.status, 200);
    assert.equal(
      (await response.text()).includes("synthetic-provider-secret"),
      false,
    );
  }
  for (const path of ["/data/private/providers.json", "/.env.local"])
    assert.equal((await fetch(f.url + path)).status, 404);
});
test("upload validation, fixture generation, persistent download and reuse complete without a live provider", async (t) => {
  const f = await fixture(t);
  const form = new FormData();
  const image = await sharp({
    create: { width: 100, height: 80, channels: 3, background: "#ab9988" },
  })
    .png()
    .toBuffer();
  form.append("image", new Blob([image]), "sample.png");
  const uploaded = await fetch(f.url + "/api/uploads", {
    method: "POST",
    headers: {
      cookie: f.headers.cookie,
      "x-session-token": f.headers["x-session-token"],
    },
    body: form,
  });
  assert.equal(uploaded.status, 200);
  const upload = await uploaded.json();
  const photo = await readFile(
    join(f.root, "data/uploads", upload.id + ".jpg"),
  );
  assert.equal((await sharp(photo).metadata()).exif, undefined);
  const generate = (name: string) =>
    fetch(f.url + "/api/generations", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({
        name,
        uploadId: upload.id,
        providerId: "fixture",
        params: {},
      }),
    });
  const created = await generate("sample");
  assert.equal(created.status, 200);
  const record = await created.json();
  assert.equal(record.phase, "submitted");
  const refreshed = await fetch(f.url + "/api/generations/sample/refresh", {
    method: "POST",
    headers: f.headers,
    body: "{}",
  });
  assert.equal(refreshed.status, 200);
  const job = await refreshed.json();
  assert.equal(job.phase, "succeeded");
  assert.equal(job.assets[0].format, "glb");
  assert.equal(job.assets[0].sha256.length, 64);
  assert.equal(JSON.stringify(job).includes("fixture.invalid"), false);
  assert.equal((await fetch(f.url + job.assets[0].url)).status, 403);
  assert.equal(
    (await fetch(f.url + job.assets[0].url, { headers: { cookie: f.headers.cookie } })).status,
    200,
  );
  assert.equal((await (await generate("same-image")).json()).reused, true);
  const invalid = new FormData();
  invalid.append("image", new Blob(["not an image"]), "bad.jpg");
  assert.equal(
    (
      await fetch(f.url + "/api/uploads", {
        method: "POST",
        headers: {
          cookie: f.headers.cookie,
          "x-session-token": f.headers["x-session-token"],
        },
        body: invalid,
      })
    ).status,
    400,
  );
});

test("multi-view HTTP preserves alpha and ordering, rejects incomplete sets, and reuses a task after restart", async (t) => {
  const f = await fixture(t);
  const ids: string[] = [];
  for (const alpha of [true, false]) {
    const bytes = await sharp({
      create: {
        width: 80,
        height: 60,
        channels: alpha ? 4 : 3,
        background: { r: 40, g: 80, b: 100, alpha: alpha ? 0.25 : 1 },
      },
    })
      .withMetadata({ orientation: 6 })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append("image", new Blob([bytes]), "view.png");
    const response = await fetch(f.url + "/api/uploads", {
      method: "POST",
      headers: {
        cookie: f.headers.cookie,
        "x-session-token": f.headers["x-session-token"],
      },
      body: form,
    });
    assert.equal(response.status, 200);
    const image = await response.json();
    ids.push(image.id);
    const loaded = await fetch(f.url + image.url, { headers: f.headers });
    assert.equal(loaded.status, 200);
    assert.match(
      loaded.headers.get("content-type")!,
      alpha ? /image\/png/ : /image\/jpeg/,
    );
    const normalized = Buffer.from(await loaded.arrayBuffer());
    const metadata = await sharp(normalized).metadata();
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.orientation, undefined);
    assert.equal(metadata.width, 60);
    assert.equal(metadata.height, 80);
    assert.equal(metadata.hasAlpha, alpha);
    if (alpha) assert.ok((await sharp(normalized).raw().toBuffer())[3] < 255);
  }
  const generate = (body: object) =>
    fetch(f.url + "/api/generations", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({
        name: "views",
        providerId: "fixture",
        params: {},
        ...body,
      }),
    });
  const opaqueRgba = await sharp({
    create: {
      width: 80,
      height: 60,
      channels: 4,
      background: { r: 40, g: 80, b: 100, alpha: 1 },
    },
  })
    .withMetadata({ orientation: 6 })
    .png()
    .toBuffer();
  assert.equal((await f.providers.upload(opaqueRgba)).id, ids[1]);
  for (const invalid of [
    {},
    { uploadIds: [] },
    { uploadIds: Array(33).fill(ids[0]) },
    { uploadId: ids[0], uploadIds: ids },
    { uploadIds: [ids[0], "invalid"] },
    { uploadIds: [ids[0], "d".repeat(64)] },
  ])
    assert.equal((await generate(invalid)).status, 400);
  assert.equal((await f.providers.jobs.store.all()).length, 0);
  const response = await generate({ uploadIds: ids });
  assert.equal(response.status, 200);
  const record = await response.json();
  assert.equal(record.reused, false);
  assert.deepEqual(record.uploadIds, ids);
  assert.equal(record.uploadId, ids[0]);
  const saved = await f.providers.jobs.store.require("views");
  assert.deepEqual(
    saved.inputs?.map((view) => view.sha256),
    ids,
  );
  assert.ok(saved.inputs?.[0].path.endsWith(".png"));
  const restarted = new Providers(f.root);
  await restarted.init();
  assert.equal(
    (await restarted.submit("alias", ids, "fixture", {})).reused,
    true,
  );
  const completed = await restarted.refresh("views");
  assert.equal(completed.phase, "succeeded");
  assert.equal(completed.assets[0].format, "glb");
  assert.equal((await restarted.jobs.store.all()).length, 1);
  assert.deepEqual(
    (await restarted.jobs.store.require("views")).inputs,
    saved.inputs,
  );
  assert.equal(
    (await restarted.submit("single", [ids[0]], "fixture", {})).reused,
    false,
  );
  assert.equal(
    (await restarted.submit("single-alias", ids[0], "fixture", {})).reused,
    true,
  );
});

test("concurrent provider settings retain both connections and unreadable private settings do not echo contents", async (t) => {
  const f = await fixture(t);
  const other = new Providers(f.root);
  await other.init();
  await Promise.all([
    f.providers.configure("synthetic-one"),
    other.configure("synthetic-two"),
  ]);
  const saved = JSON.parse(
    await readFile(join(f.root, "data/private/providers.json"), "utf8"),
  );
  assert.equal(saved.connections.length, 2);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    join(f.root, "data/private/providers.json"),
    "private-corrupt-content",
  );
  await assert.rejects(
    new Providers(f.root).init(),
    (error) =>
      error instanceof Error &&
      !error.message.includes("private-corrupt-content"),
  );
});

test("Tailscale HTTP admin login and write retain session authentication and reject forged origins/forwarded hosts", async (t) => {
  const f = await fixture(t, {
    tailscaleIP: "100.100.100.100",
    tailscaleHostnames: ["atlas.example-tail.ts.net"],
  });
  const host = "atlas.example-tail.ts.net:4100";
  const adminKey = (
    await readFile(join(f.root, "data/private/admin-token"), "utf8")
  ).trim();
  async function request(
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
  ) {
    return new Promise<{
      status: number;
      headers: import("node:http").IncomingHttpHeaders;
      body: string;
    }>((resolve, reject) => {
      const req = httpRequest(
        f.url + path,
        {
          method: body ? "POST" : "GET",
          headers: {
            Host: host,
            ...headers,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
        },
        (res) => {
          let text = "";
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              body: text,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  const boot = await request("/api/admin/login", { Origin: "http://" + host }, { key: adminKey });
  assert.equal(boot.status, 200);
  const cookie = boot.headers["set-cookie"]![0].split(";")[0];
  const token = JSON.parse(boot.body).csrfToken;
  const input = {
    operationId: randomUUID(),
    expectedRevision: 0,
    issuedAt: new Date().toISOString(),
    action: { type: "stock.adjust", stockId: "cat-litter", delta: 1 },
  };
  assert.equal(
    (
      await request(
        "/api/commands",
        { Origin: "http://" + host, Cookie: cookie },
        input,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/commands",
        {
          Origin: "http://attacker.invalid",
          Cookie: cookie,
          "X-Session-Token": token,
        },
        input,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/state", {
        Host: "attacker.invalid",
        "X-Forwarded-Host": host,
        Cookie: cookie,
      })
    ).status,
    403,
  );
  const applied = await request(
    "/api/commands",
    { Origin: "http://" + host, Cookie: cookie, "X-Session-Token": token },
    input,
  );
  assert.equal(applied.status, 200);
  assert.equal(JSON.parse(applied.body).result.quantity, 4);
});

test("layout photos remain authenticated private files with an explicit filename allowlist", async (t) => {
  const f = await fixture(t);
  const directory = join(f.root, "data/layout-reference");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "notes.md"), "Private reference notes", {
    mode: 0o600,
  });
  const image = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#aa9988" },
  })
    .png()
    .toBuffer();
  await writeFile(join(directory, "bedroom-south.png"), image, { mode: 0o600 });
  assert.equal(
    (await fetch(f.url + "/api/layout-reference/images/bedroom-south")).status,
    403,
  );
  const index = await fetch(f.url + "/api/layout-reference", {
    headers: f.headers,
  });
  assert.equal((await index.json()).images.length, 4);
  const response = await fetch(
    f.url + "/api/layout-reference/images/bedroom-south",
    { headers: f.headers },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  assert.equal(
    (
      await fetch(f.url + "/api/layout-reference/images/source", {
        headers: f.headers,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(f.url + "/api/layout-reference/images/%2e%2e%2fsource", {
        headers: f.headers,
      })
    ).status,
    404,
  );
});

test("GLB import requires browser write authority and serves only validated local assets", async (t) => {
  const f = await fixture(t);
  const bytes = await readFile(
    new URL("../public/models/offline-robot.glb", import.meta.url),
  );
  const form = () => {
    const body = new FormData();
    body.append("model", new Blob([bytes]), "robot.glb");
    return body;
  };
  assert.equal(
    (
      await fetch(f.url + "/api/assets/import", {
        method: "POST",
        body: form(),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(f.url + "/api/assets/import", {
        method: "POST",
        headers: { authorization: f.agentHeaders.authorization },
        body: form(),
      })
    ).status,
    403,
  );
  const headers = {
    cookie: f.headers.cookie,
    "x-session-token": f.headers["x-session-token"],
  };
  const results = await Promise.all(
    [1, 2].map(() =>
      fetch(f.url + "/api/assets/import", {
        method: "POST",
        headers,
        body: form(),
      }),
    ),
  );
  for (const response of results) assert.equal(response.status, 200);
  const [a, b] = await Promise.all(results.map((r) => r.json()));
  assert.equal(a.url, b.url);
  assert.equal((await fetch(f.url + a.url)).status, 403);
  assert.deepEqual(
    Buffer.from(
      await (
        await fetch(f.url + a.url, { headers: { cookie: f.headers.cookie } })
      ).arrayBuffer(),
    ),
    bytes,
  );
  assert.equal(
    (await (await fetch(f.url + "/api/assets/imports", { headers })).json())
      .length,
    1,
  );
  for (const source of [
    "{broken",
    JSON.stringify({ url: "javascript:alert(1)" }),
    JSON.stringify({ url: "https://user:password@example.org/model" }),
    JSON.stringify({ author: "x".repeat(161) }),
  ]) {
    const invalid = form();
    invalid.append("source", source);
    const response = await fetch(f.url + "/api/assets/import", {
      method: "POST",
      headers,
      body: invalid,
    });
    assert.equal(response.status, 400);
  }
  const sourced = form();
  const source = {
    platform: "Offline fixture catalog",
    url: "https://example.org/model",
    author: "Fixture author",
    license: "Synthetic test metadata",
  };
  sourced.append("source", JSON.stringify(source));
  const sourceResponse = await fetch(f.url + "/api/assets/import", {
    method: "POST",
    headers,
    body: sourced,
  });
  assert.equal(sourceResponse.status, 200);
  const imported = await sourceResponse.json();
  assert.equal(imported.url, a.url);
  assert.notEqual(imported.id, a.id);
  assert.deepEqual(imported.source, source);
  const library = await (
    await fetch(f.url + "/api/assets/imports", { headers })
  ).json();
  assert.equal(library.length, 2);
  assert.deepEqual(
    library.find((model: { id: string }) => model.id === imported.id).source,
    source,
  );
  const bad = new FormData();
  bad.append("model", new Blob(["not GLB"]), "bad.glb");
  assert.equal(
    (
      await fetch(f.url + "/api/assets/import", {
        method: "POST",
        headers,
        body: bad,
      })
    ).status,
    400,
  );
});

test("standalone local icon library accepts agent and browser uploads, deduplicates by hash and binds to services", async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(f.url + "/api/icons")).status, 403);

  const agentAuth = { authorization: f.agentHeaders.authorization };
  const catalogRes = await fetch(f.url + "/api/icons", { headers: agentAuth });
  assert.equal(catalogRes.status, 200);
  const catalog = await catalogRes.json();
  assert.ok(
    catalog.builtin.some((item: { key: string }) => item.key === "gitea"),
  );
  assert.deepEqual(catalog.library, []);

  const svgBytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#16a34a"/><circle cx="16" cy="16" r="7" fill="#fff"/></svg>',
  );
  const form = () => {
    const fd = new FormData();
    fd.append(
      "image",
      new Blob([svgBytes], { type: "image/svg+xml" }),
      "custom-app.svg",
    );
    fd.append("name", "Custom App");
    return fd;
  };
  const firstUpload = await fetch(f.url + "/api/icons", {
    method: "POST",
    headers: agentAuth,
    body: form(),
  });
  assert.equal(firstUpload.status, 200);
  const uploaded = await firstUpload.json();
  assert.match(uploaded.url, /^\/api\/icons\/[a-f0-9]{64}$/);
  assert.equal(uploaded.name, "Custom App");

  // Browser upload of identical image deduplicates to the same SHA-256 entry.
  const browserHeaders = {
    cookie: f.headers.cookie,
    "x-session-token": f.headers["x-session-token"],
  };
  const secondUpload = await fetch(f.url + "/api/icons", {
    method: "POST",
    headers: browserHeaders,
    body: form(),
  });
  assert.equal(secondUpload.status, 200);
  const deduped = await secondUpload.json();
  assert.equal(deduped.url, uploaded.url);

  const served = await fetch(f.url + uploaded.url, { headers: agentAuth });
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  const servedMeta = await sharp(
    Buffer.from(await served.arrayBuffer()),
  ).metadata();
  assert.equal(servedMeta.format, "png");

  const invalidForm = new FormData();
  invalidForm.append("image", new Blob(["not an image"]), "broken.png");
  assert.equal(
    (
      await fetch(f.url + "/api/icons", {
        method: "POST",
        headers: agentAuth,
        body: invalidForm,
      })
    ).status,
    400,
  );

  // Bind both custom library icon and reject external URL icons via service.upsert.
  const initialState = await (
    await fetch(f.url + "/api/state", { headers: agentAuth })
  ).json();
  const hostId = initialState.home.entities.find(
    (e: { category: string }) => e.category === "host",
  ).id;
  const badCmd = await fetch(f.url + "/api/commands", {
    method: "POST",
    headers: f.agentHeaders,
    body: JSON.stringify({
      operationId: randomUUID(),
      expectedRevision: initialState.revision,
      issuedAt: new Date().toISOString(),
      action: {
        type: "service.upsert",
        service: {
          id: "bad-icon-svc",
          entityId: hostId,
          name: "Bad Icon",
          version: "1.0",
          embed: "unverified",
          icon: "https://evil.invalid/icon.png",
          description: "",
          asOf: "2026-11-15",
          demo: false,
        },
      },
    }),
  });
  assert.equal(badCmd.status, 400);

  const goodCmd = await fetch(f.url + "/api/commands", {
    method: "POST",
    headers: f.agentHeaders,
    body: JSON.stringify({
      operationId: randomUUID(),
      expectedRevision: initialState.revision,
      issuedAt: new Date().toISOString(),
      action: {
        type: "service.upsert",
        service: {
          id: "custom-icon-svc",
          entityId: hostId,
          name: "Custom App",
          version: "1.0",
          embed: "unverified",
          icon: uploaded.url,
          description: "",
          asOf: "2026-11-15",
          demo: false,
        },
      },
    }),
  });
  assert.equal(goodCmd.status, 200);
  const updatedState = await (
    await fetch(f.url + "/api/state", { headers: agentAuth })
  ).json();
  assert.equal(
    updatedState.home.services.find(
      (s: { id: string }) => s.id === "custom-icon-svc",
    ).icon,
    uploaded.url,
  );
});

test("Streamable HTTP /mcp exposes discoverable tools and resources without requiring endpoint memorization", async (t) => {
  const f = await fixture(t);

  // Unauthenticated MCP calls must fail with 403.
  const unauth = await fetch(f.url + "/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "unauth-test", version: "1.0.0" },
      },
      id: 1,
    }),
  });
  assert.equal(unauth.status, 403);

  // Connect a real MCP Client using the agent Bearer token over Streamable HTTP.
  const agentClient = new Client({
    name: "homelab-owner-agent",
    version: "1.0.0",
  });
  const agentTransport = new StreamableHTTPClientTransport(
    new URL("/mcp", f.url),
    {
      requestInit: {
        headers: {
          Authorization: f.agentHeaders.authorization,
        },
      },
    },
  );
  await agentClient.connect(agentTransport);
  t.after(async () => {
    await agentTransport.close();
  });

  const listed = await agentClient.listTools();
  const names = listed.tools.map((tool) => tool.name);
  for (const required of [
    "get_home_state",
    "list_icons",
    "list_imported_models",
    "upsert_service",
    "replace_cyber_graph",
    "inspect_cyber_architecture",
    "upsert_cyber_node",
    "delete_cyber_node",
    "upsert_cyber_edge",
    "delete_cyber_edge",
    "upsert_cyber_zone",
    "delete_cyber_zone",
    "configure_cyber_taxonomy",
    "upsert_electrical_circuit",
    "upload_icon",
    "record_item",
    "adjust_stock",
    "acknowledge_incident",
    "ingest_event",
    "run_domain_command",
  ]) {
    assert.ok(names.includes(required), `Missing MCP tool: ${required}`);
    const def = listed.tools.find((t) => t.name === required)!;
    assert.equal(def.inputSchema.type, "object");
  }

  const resources = await agentClient.listResources();
  const uris = resources.resources.map((r) => r.uri);
  assert.ok(uris.includes("homelab://state"));
  assert.ok(uris.includes("homelab://icons"));

  // Summary read discovers existing entity IDs without manual HTTP calls.
  const summaryRes = await agentClient.callTool({
    name: "get_home_state",
    arguments: { section: "summary" },
  });
  const summary = JSON.parse(
    (summaryRes.content as { type: string; text: string }[])[0]!.text,
  ) as {
    revision: number;
    entities: { id: string; category: string }[];
  };
  const hostId = summary.entities.find((e) => e.category === "host")?.id;
  assert.ok(hostId);

  // Upload a custom icon via MCP and bind it cleanly via upsert_service.
  const pngBytes = await sharp({
    create: {
      width: 24,
      height: 24,
      channels: 4,
      background: { r: 22, g: 163, b: 74, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const uploadedRes = await agentClient.callTool({
    name: "upload_icon",
    arguments: {
      name: "MCP App",
      imageBase64: pngBytes.toString("base64"),
    },
  });
  const uploadedIcon = JSON.parse(
    (uploadedRes.content as { type: string; text: string }[])[0]!.text,
  ) as { url: string };
  assert.match(uploadedIcon.url, /^\/api\/icons\/[a-f0-9]{64}$/);

  const opId = randomUUID();
  const issuedAt = new Date().toISOString();
  const upsertRes = await agentClient.callTool({
    name: "upsert_service",
    arguments: {
      operationId: opId,
      issuedAt,
      service: {
        id: "mcp-service",
        entityId: hostId,
        name: "MCP Service",
        version: "1.2.0",
        embed: "unverified",
        icon: uploadedIcon.url,
        description: "Registered directly through MCP",
        asOf: "2026-11-15T00:00:00Z",
        demo: false,
      },
    },
  });
  assert.ok(!upsertRes.isError);
  const receipt1 = JSON.parse(
    (upsertRes.content as { type: string; text: string }[])[0]!.text,
  ) as { revision: number; operationId: string };
  assert.equal(receipt1.operationId, opId);

  // Idempotent replay with same operationId, issuedAt & expectedRevision returns original receipt.
  const replayRes = await agentClient.callTool({
    name: "upsert_service",
    arguments: {
      operationId: opId,
      expectedRevision: summary.revision,
      issuedAt,
      service: {
        id: "mcp-service",
        entityId: hostId,
        name: "MCP Service",
        version: "1.2.0",
        embed: "unverified",
        icon: uploadedIcon.url,
        description: "Registered directly through MCP",
        asOf: "2026-11-15T00:00:00Z",
        demo: false,
      },
    },
  });
  const receipt2 = JSON.parse(
    (replayRes.content as { type: string; text: string }[])[0]!.text,
  ) as { revision: number };
  assert.equal(receipt2.revision, receipt1.revision);

  // Update Cyber topology & acknowledge ingested alert via MCP.
  const cyberRes = await agentClient.callTool({
    name: "replace_cyber_graph",
    arguments: {
      graph: {
        version: 1,
        source: "mcp-agent",
        asOf: "2026-11-15T01:00:00Z",
        nodes: [
          {
            id: "mcp-app",
            label: "MCP Service",
            host: hostId,
            serviceId: "mcp-service",
            icon: uploadedIcon.url,
          },
          { id: "edge-ext", label: "Gateway", kind: "external" },
        ],
        edges: [
          {
            id: "mcp-e1",
            source: "mcp-app",
            target: "edge-ext",
            label: "HTTPS",
            groups: ["出网"],
          },
        ],
      },
    },
  });
  assert.ok(!cyberRes.isError);

  const eventRes = await agentClient.callTool({
    name: "ingest_event",
    arguments: {
      event: {
        schemaVersion: 1,
        eventId: "mcp-evt-1",
        source: "mcp-agent",
        subjectId: "mcp-service",
        condition: "availability",
        status: "open",
        severity: "warning",
        message: "Health check timed out",
        observedAt: new Date().toISOString(),
        ttlSeconds: 300,
      },
    },
  });
  assert.ok(!eventRes.isError);

  const incidentsRes = await agentClient.callTool({
    name: "get_home_state",
    arguments: { section: "incidents" },
  });
  const incidents = (
    JSON.parse(
      (incidentsRes.content as { type: string; text: string }[])[0]!.text,
    ) as { incidents: { id: string; subjectId: string }[] }
  ).incidents;
  const openIncident = incidents.find((i) => i.subjectId === "mcp-service");
  assert.ok(openIncident);

  const ackRes = await agentClient.callTool({
    name: "acknowledge_incident",
    arguments: { incidentId: openIncident.id },
  });
  assert.ok(!ackRes.isError);

  // A browser-authenticated MCP client must still be denied agent-only event ingestion.
  const browserClient = new Client({
    name: "browser-mcp",
    version: "1.0.0",
  });
  const browserTransport = new StreamableHTTPClientTransport(
    new URL("/mcp", f.url),
    {
      requestInit: {
        headers: f.headers,
      },
    },
  );
  await browserClient.connect(browserTransport);
  t.after(async () => {
    await browserTransport.close();
  });
  const forbiddenEvent = await browserClient.callTool({
    name: "ingest_event",
    arguments: {
      event: {
        schemaVersion: 1,
        eventId: "browser-evt-1",
        source: "browser-spoof",
        subjectId: "mcp-service",
        condition: "availability",
        status: "open",
        severity: "warning",
        message: "Should fail",
        observedAt: new Date().toISOString(),
        ttlSeconds: 300,
      },
    },
  });
  assert.equal(forbiddenEvent.isError, true);

  // Incremental cyber architecture tools & resources work without replacing the entire snapshot.
  const taxRes = await agentClient.callTool({
    name: "configure_cyber_taxonomy",
    arguments: {
      categories: {
        "ai-lab": {
          label: "AI 工作台",
          shortLabel: "AI",
          color: "#c084fc",
          defaultLayer: "app",
          order: 1,
        },
      },
      topologies: {
        mesh: {
          label: "核心服务网格",
          description: "跨机互联核心服务",
          order: 1,
        },
      },
    },
  });
  assert.ok(!taxRes.isError);

  const zoneRes = await agentClient.callTool({
    name: "upsert_cyber_zone",
    arguments: {
      zone: {
        id: "mcp-dmz",
        label: "MCP DMZ 隔离域",
        isolation: "strict",
        hosts: [hostId],
      },
    },
  });
  assert.ok(!zoneRes.isError);

  const nodeUpsertRes = await agentClient.callTool({
    name: "upsert_cyber_node",
    arguments: {
      node: {
        id: "mcp-pg",
        label: "PG Vector DB",
        host: hostId,
        kind: "database",
        zone: "mcp-dmz",
        icon: "postgresql",
        groups: ["mesh"],
      },
    },
  });
  assert.ok(!nodeUpsertRes.isError);

  const edgeUpsertRes = await agentClient.callTool({
    name: "upsert_cyber_edge",
    arguments: {
      edge: {
        id: "e-mcp-db",
        source: "mcp-app",
        target: "mcp-pg",
        label: "PG",
        groups: ["mesh"],
      },
    },
  });
  assert.ok(!edgeUpsertRes.isError);

  const inspectRes = await agentClient.callTool({
    name: "inspect_cyber_architecture",
    arguments: { hostId, includeMermaid: true },
  });
  assert.ok(!inspectRes.isError);
  const inspected = JSON.parse(
    (inspectRes.content as { type: string; text: string }[])[0]!.text,
  ) as {
    zones: { id: string; isolation: string }[];
    hosts: { hostId: string; mermaid?: string }[];
    nodes: { id: string; effective: { zoneId?: string } }[];
  };
  assert.ok(inspected.zones.some((z) => z.id === "mcp-dmz"));
  assert.equal(
    inspected.nodes.find((n) => n.id === "mcp-pg")?.effective.zoneId,
    "mcp-dmz",
  );
  assert.ok(inspected.hosts[0]?.mermaid?.includes("flowchart TD"));

  const cyberResources = await agentClient.listResources();
  assert.ok(cyberResources.resources.some((r) => r.uri === "homelab://cyber"));
  assert.ok(
    cyberResources.resources.some(
      (r) => r.uri === "homelab://cyber/architecture",
    ),
  );
  const archResource = await agentClient.readResource({
    uri: "homelab://cyber/architecture",
  });
  const archText = (archResource.contents[0] as { text?: string })?.text ?? "";
  assert.ok(archText.includes("mcp-dmz"));

  // Deleting a zone clears dangling node references; deleting a node prunes incident edges.
  const delZoneRes = await agentClient.callTool({
    name: "delete_cyber_zone",
    arguments: { id: "mcp-dmz" },
  });
  assert.ok(!delZoneRes.isError);
  const delNodeRes = await agentClient.callTool({
    name: "delete_cyber_node",
    arguments: { id: "mcp-pg" },
  });
  assert.ok(!delNodeRes.isError);

  const afterDelState = await agentClient.callTool({
    name: "get_home_state",
    arguments: { section: "cyber" },
  });
  const afterCyber = (
    JSON.parse(
      (afterDelState.content as { type: string; text: string }[])[0]!.text,
    ) as {
      cyber: {
        nodes: { id: string }[];
        edges: { id: string }[];
        zones?: { id: string }[];
      };
    }
  ).cyber;
  assert.ok(!afterCyber.nodes.some((n) => n.id === "mcp-pg"));
  assert.ok(!afterCyber.edges.some((e) => e.id === "e-mcp-db"));
  assert.ok(!(afterCyber.zones ?? []).some((z) => z.id === "mcp-dmz"));
});
