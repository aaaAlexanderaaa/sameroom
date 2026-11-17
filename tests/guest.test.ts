import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import sharp from "sharp";
import { createApp } from "../server/app.js";
import {
  projectGuestDashboard,
  resolveHotspotWorldPosition,
} from "../shared/guest.js";

test("guest projection strips private data, stocks, services, logical rooms and hidden subtrees while enforcing media allowlists", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "home-guest-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { app, store, agentToken } = await createApp(root);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  // Unauthenticated visitor sees guest role and zero admin access (403).
  const sessionRes = await fetch(url + "/api/session");
  assert.equal(sessionRes.status, 200);
  assert.deepEqual(await sessionRes.json(), { role: "guest" });

  for (const blocked of [
    "/api/state",
    "/api/export",
    "/api/command-schema",
    "/api/templates",
    "/api/world-example/state",
    "/api/providers",
    "/api/generations",
    "/api/assets/imports",
    "/api/icons",
    "/api/layout-reference",
    "/inspector.html",
    "/demo/service",
    "/generated/manifest.json",
    "/icons/services/docker.svg",
  ]) {
    const res = await fetch(url + blocked);
    assert.equal(
      res.status,
      403,
      `Expected 403 for ${blocked}, got ${res.status}`,
    );
  }

  // Wrong login keys fail with 403 and trigger 429 rate limiting after repeated failures.
  for (let i = 0; i < 5; i++) {
    const fail = await fetch(url + "/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "wrong-key-" + i }),
    });
    assert.equal(fail.status, 403);
  }
  const locked = await fetch(url + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "wrong-key-again" }),
  });
  assert.equal(locked.status, 429);

  // Fresh instance with explicit DASH_ADMIN_KEY verifies login, session persistence across restart, and logout.
  const prevKey = process.env.DASH_ADMIN_KEY;
  process.env.DASH_ADMIN_KEY = "super-secret-admin-key-987654";
  t.after(() => {
    if (prevKey === undefined) delete process.env.DASH_ADMIN_KEY;
    else process.env.DASH_ADMIN_KEY = prevKey;
  });

  const root2 = await mkdtemp(join(tmpdir(), "home-guest-persist-"));
  t.after(() => rm(root2, { recursive: true, force: true }));
  const appA = await createApp(root2);
  const srvA = appA.app.listen(0, "127.0.0.1");
  t.after(() => {
    srvA.closeAllConnections();
    srvA.close();
  });
  await once(srvA, "listening");
  const urlA = `http://127.0.0.1:${(srvA.address() as { port: number }).port}`;

  const loginRes = await fetch(urlA + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "super-secret-admin-key-987654" }),
  });
  assert.equal(loginRes.status, 200);
  const cookie = loginRes.headers.get("set-cookie")!.split(";")[0];
  const { csrfToken } = (await loginRes.json()) as { csrfToken: string };

  // Upload two photos: one private item photo, one guest album photo.
  const makePng = (bg: string) =>
    sharp({ create: { width: 12, height: 12, channels: 3, background: bg } })
      .png()
      .toBuffer();

  const upload = async (bg: string) => {
    const fd = new FormData();
    fd.append(
      "image",
      new Blob([await makePng(bg)], { type: "image/png" }),
      "p.png",
    );
    const r = await fetch(urlA + "/api/uploads", {
      method: "POST",
      headers: { Cookie: cookie, "X-Session-Token": csrfToken },
      body: fd,
    });
    assert.equal(r.status, 200);
    return (await r.json()) as { id: string; url: string };
  };
  const privatePhoto = await upload("#223344");
  const albumPhoto = await upload("#aa6644");

  const snap = await appA.store.snapshot();
  const desk = snap.home.entities.find(
    (e) =>
      e.scope === "home" &&
      e.lifecycle === "active" &&
      e.visibility !== "editing",
  )!;
  const secondEntity = snap.home.entities.find(
    (e) =>
      e.id !== desk.id &&
      e.scope === "home" &&
      e.lifecycle === "active" &&
      e.visibility !== "editing",
  )!;

  const cmd = async (action: unknown, rev: number) => {
    const res = await fetch(urlA + "/api/commands", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "X-Session-Token": csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operationId: randomUUID(),
        expectedRevision: rev,
        issuedAt: new Date().toISOString(),
        action,
      }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    return JSON.parse(text) as { revision: number };
  };

  let rev = snap.revision;
  rev = (
    await cmd(
      { type: "item.photos", itemId: desk.id, photos: [privatePhoto.url] },
      rev,
    )
  ).revision;
  rev = (
    await cmd(
      {
        type: "entity.guest",
        entityId: desk.id,
        guest: { visibility: "backdrop", summary: "公开桌面概览" },
      },
      rev,
    )
  ).revision;
  rev = (
    await cmd(
      {
        type: "entity.guest",
        entityId: secondEntity.id,
        guest: { visibility: "hide" },
      },
      rev,
    )
  ).revision;
  rev = (
    await cmd(
      {
        type: "hotspot.upsert",
        hotspot: {
          id: "hs-album",
          label: "桌面记忆相册",
          audience: "guest-and-admin",
          anchor: { kind: "entity", entityId: desk.id, offset: [0.1, 0.3, 0] },
          visual: {
            size: "md",
            pulse: "soft",
            color: "#3d7a64",
            icon: "images",
          },
          effect: {
            kind: "album",
            title: "我的工作台",
            layout: "polaroid",
            items: [{ photo: albumPhoto.url, caption: "第一张照片" }],
          },
        },
      },
      rev,
    )
  ).revision;
  rev = (
    await cmd(
      {
        type: "hotspot.upsert",
        hotspot: {
          id: "hs-admin-draft",
          label: "仅管理者可见草稿",
          audience: "admin-only",
          anchor: { kind: "entity", entityId: desk.id, offset: [0, 0.4, 0] },
          visual: { size: "sm", pulse: "static" },
          effect: {
            kind: "envelope",
            title: "草稿",
            theme: "cream",
            body: "内部草稿内容",
          },
        },
      },
      rev,
    )
  ).revision;

  // Verify guest projection strips sensitive info & keeps only whitelisted media.
  const guestRes = await fetch(urlA + "/api/guest/state");
  assert.equal(guestRes.status, 200);
  const guestJson = await guestRes.json();
  assert.equal(guestJson.revision, rev);
  assert.equal("stocks" in guestJson.home, false);
  assert.equal("services" in guestJson.home, false);
  assert.equal("cyber" in guestJson.home, false);
  assert.equal("electricalCircuits" in guestJson.home, false);
  assert.equal("observations" in guestJson, false);
  assert.equal("incidents" in guestJson, false);
  assert.equal(
    guestJson.home.rooms.every((r: { kind: string }) => r.kind === "room"),
    true,
  );
  const projectedDesk = guestJson.home.entities.find(
    (e: { id: string }) => e.id === desk.id,
  );
  assert.equal(projectedDesk.guestInteraction, "backdrop");
  assert.equal(projectedDesk.publicSummary, "公开桌面概览");
  assert.equal("notes" in projectedDesk, false);
  assert.equal("photos" in projectedDesk, false);
  assert.equal(
    guestJson.home.entities.some(
      (e: { id: string }) => e.id === secondEntity.id,
    ),
    false,
  );
  assert.deepEqual(
    guestJson.home.hotspots.map((h: { id: string }) => h.id),
    ["hs-album"],
  );
  assert.equal(
    guestJson.home.hotspots[0].effect.items[0].photo,
    `/api/guest/uploads/${albumPhoto.id}`,
  );

  // Guest media allowlist: album photo works on /api/guest/uploads, private item photo gets 403!
  assert.equal(
    (await fetch(urlA + `/api/guest/uploads/${albumPhoto.id}`)).status,
    200,
  );
  assert.equal(
    (await fetch(urlA + `/api/guest/uploads/${privatePhoto.id}`)).status,
    403,
  );
  assert.equal(
    (await fetch(urlA + `/api/uploads/${albumPhoto.id}`)).status,
    403,
  );

  // Generated GLB allowlist: non-visible GLB returns 403 to visitors, visible or admin returns 200.
  await mkdir(join(root2, "public/generated/secret-model"), {
    recursive: true,
  });
  await writeFile(
    join(root2, "public/generated/secret-model/0.glb"),
    "glTF-dummy",
  );
  assert.equal(
    (await fetch(urlA + "/generated/secret-model/0.glb")).status,
    403,
  );
  assert.equal(
    (
      await fetch(urlA + "/generated/secret-model/0.glb", {
        headers: { Cookie: cookie },
      })
    ).status,
    200,
  );

  // Restart server with same data root: persisted admin session still works!
  srvA.closeAllConnections();
  await new Promise<void>((r) => srvA.close(() => r()));
  const appB = await createApp(root2);
  const srvB = appB.app.listen(0, "127.0.0.1");
  await once(srvB, "listening");
  t.after(() => {
    srvB.closeAllConnections();
    srvB.close();
  });
  const urlB = `http://127.0.0.1:${(srvB.address() as { port: number }).port}`;
  const afterRestart = await fetch(urlB + "/api/session", {
    headers: { Cookie: cookie },
  });
  assert.deepEqual(await afterRestart.json(), { role: "admin", csrfToken });

  // Logout revokes the session cleanly.
  const logoutRes = await fetch(urlB + "/api/admin/logout", {
    method: "POST",
    headers: { Cookie: cookie, "X-Session-Token": csrfToken },
  });
  assert.equal(logoutRes.status, 200);
  assert.deepEqual(
    await (
      await fetch(urlB + "/api/session", { headers: { Cookie: cookie } })
    ).json(),
    { role: "guest" },
  );

  // Verify entity-anchored hotspot world position follows entity rotation.
  const rotated = resolveHotspotWorldPosition(
    {
      rooms: [{ id: "r1", origin: [10, 0, -5] }],
      entities: [
        {
          id: "e1",
          locationId: "r1",
          position: [1, 0, 2],
          rotation: Math.PI / 2,
        },
      ],
    },
    {
      id: "hs-rot",
      label: "rot",
      audience: "guest-and-admin",
      anchor: { kind: "entity", entityId: "e1", offset: [1, 0.5, 0] },
      visual: { size: "md", pulse: "soft" },
      effect: {
        kind: "link",
        title: "x",
        url: "https://example.com",
        openMode: "card",
      },
    },
  )!;
  assert.ok(Math.abs(rotated[0] - 11) < 1e-6);
  assert.ok(Math.abs(rotated[1] - 0.5) < 1e-6);
  assert.ok(Math.abs(rotated[2] - -4) < 1e-6);
  // Prevent unused warning on agentToken / store
  assert.ok(agentToken && store);
  const projectedUnit = projectGuestDashboard(await appB.store.snapshot());
  assert.equal(projectedUnit.home.hotspots.length, 1);

  // Verify typewriter envelope & popup spotlight hotspot fields preserve cleanly
  const r2 = (
    await appB.store.execute({
      operationId: randomUUID(),
      expectedRevision: rev,
      issuedAt: new Date().toISOString(),
      action: {
        type: "hotspot.upsert",
        hotspot: {
          id: "hs-typewriter",
          label: "桌面键盘来信",
          audience: "guest-and-admin",
          anchor: { kind: "entity", entityId: desk.id, offset: [0, 0.2, 0] },
          visual: { size: "md", pulse: "beacon" },
          effect: {
            kind: "envelope",
            title: "一封信",
            theme: "cream",
            typewriter: true,
            typingDurationSeconds: 20,
            body: "你好，朋友。\n\n这是打字机测试。",
          },
        },
      },
    })
  ).revision;
  const r3 = (
    await appB.store.execute({
      operationId: randomUUID(),
      expectedRevision: r2,
      issuedAt: new Date().toISOString(),
      action: {
        type: "hotspot.upsert",
        hotspot: {
          id: "hs-popup",
          label: "喝水提醒",
          audience: "guest-only",
          anchor: { kind: "entity", entityId: desk.id, offset: [0.2, 0.2, 0] },
          visual: { size: "sm", pulse: "soft" },
          effect: {
            kind: "spotlight",
            title: "养生壶",
            badge: "记得补水",
            presentation: "popup",
            story: "看到我立马去喝水",
            targetEntityId: desk.id,
          },
        },
      },
    })
  ).revision;
  const withExtras = projectGuestDashboard(await appB.store.snapshot());
  const pw = withExtras.home.hotspots.find((h) => h.id === "hs-typewriter");
  const pop = withExtras.home.hotspots.find((h) => h.id === "hs-popup");
  assert.equal(pw?.effect.kind, "envelope");
  if (pw?.effect.kind === "envelope") {
    assert.equal(pw.effect.typewriter, true);
    assert.equal(pw.effect.typingDurationSeconds, 20);
  }
  assert.equal(pop?.effect.kind, "spotlight");
  if (pop?.effect.kind === "spotlight") {
    assert.equal(pop.effect.presentation, "popup");
    assert.equal(pop.effect.badge, "记得补水");
  }
  const r4 = (
    await appB.store.execute({
      operationId: randomUUID(),
      expectedRevision: r3,
      issuedAt: new Date().toISOString(),
      action: { type: "hotspot.delete", hotspotId: "hs-typewriter" },
    })
  ).revision;
  const r5 = (
    await appB.store.execute({
      operationId: randomUUID(),
      expectedRevision: r4,
      issuedAt: new Date().toISOString(),
      action: { type: "hotspot.delete", hotspotId: "hs-popup" },
    })
  ).revision;

  // Check hotspot deletion command as well
  await appB.store.execute({
    operationId: randomUUID(),
    expectedRevision: r5,
    issuedAt: new Date().toISOString(),
    action: { type: "hotspot.delete", hotspotId: "hs-album" },
  });
  assert.equal(
    projectGuestDashboard(await appB.store.snapshot()).home.hotspots.length,
    0,
  );
  // Check admin-token file created on default root
  const generatedToken = (
    await readFile(join(root, "data/private/admin-token"), "utf8")
  ).trim();
  assert.equal(/^[a-f0-9]{64}$/.test(generatedToken), true);
});
