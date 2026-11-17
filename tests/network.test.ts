import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptsRequest,
  isHttpsOrigin,
  networkAccess,
} from "../server/network.js";

const access = networkAccess({
  DASH_TAILSCALE_IP: "100.100.100.100",
  DASH_TAILSCALE_HOSTNAMES: "atlas,atlas.example-tail.ts.net",
});
test("Tailscale opt-in limits Host, peer and same-origin checks to the configured node", () => {
  for (const host of [
    "100.100.100.100:4100",
    "atlas:4100",
    "atlas.example-tail.ts.net:4100",
  ]) {
    assert.equal(
      acceptsRequest(access, host, "http://" + host, "100.90.20.30"),
      true,
    );
    assert.equal(
      acceptsRequest({}, host, "http://" + host, "100.90.20.30"),
      false,
    );
    assert.equal(
      acceptsRequest(access, host, "http://" + host, "192.168.1.3"),
      false,
    );
    assert.equal(
      acceptsRequest(access, host, "http://" + host, "203.0.113.4"),
      false,
    );
    for (const origin of [
      "null",
      "https://" + host,
      "http://attacker.invalid",
      "http://100.100.100.100:9999",
      "http://" + host + "/path",
    ]) {
      assert.equal(acceptsRequest(access, host, origin, "100.90.20.30"), false);
    }
  }
  for (const host of [
    "100.100.100.101:4100",
    "another.example-tail.ts.net:4100",
    "atlas.attacker.invalid:4100",
    "user@atlas:4100",
    "atlas:4100/path",
  ]) {
    assert.equal(
      acceptsRequest(access, host, undefined, "100.90.20.30"),
      false,
    );
  }
  assert.equal(
    acceptsRequest(
      access,
      "127.0.0.1:4100",
      "http://127.0.0.1:4100",
      "127.0.0.1",
    ),
    true,
  );
  assert.equal(
    acceptsRequest({}, "localhost:4173", undefined, "::ffff:127.0.0.1"),
    true,
  );
  assert.equal(
    acceptsRequest(access, "atlas:4100", undefined, "fd7a:115c:a1e0::1"),
    true,
  );
});
test("network configuration rejects wildcard/public/LAN bind addresses and wildcard hosts", () => {
  assert.deepEqual(networkAccess({}), {
    tailscaleIP: undefined,
    tailscaleHostnames: [],
  });
  for (const ip of [
    "0.0.0.0",
    "::",
    "192.168.1.5",
    "100.63.255.255",
    "100.128.0.1",
    "attacker.invalid",
  ]) {
    assert.throws(
      () => networkAccess({ DASH_TAILSCALE_IP: ip }),
      /Tailscale IP/,
    );
  }
  assert.throws(
    () => networkAccess({ DASH_TAILSCALE_HOSTNAMES: "atlas" }),
    /require/,
  );
  assert.throws(
    () =>
      networkAccess({
        DASH_TAILSCALE_IP: "100.100.100.100",
        DASH_TAILSCALE_HOSTNAMES: "*.ts.net",
      }),
    /exact DNS/,
  );
  assert.throws(
    () => networkAccess({ DASH_BIND_HOST: "192.168.1.5" }),
    /127\.0\.0\.1 or 0\.0\.0\.0/,
  );
  assert.throws(
    () => networkAccess({ DASH_ALLOWED_HOSTS: "*.example.com" }),
    /exact IPs or DNS/,
  );
  const dockerAccess = networkAccess({
    DASH_BIND_HOST: "0.0.0.0",
    DASH_ALLOW_REMOTE_PEERS: "1",
    DASH_ALLOWED_HOSTS: "192.0.2.20,node.example-tailnet.ts.net",
  });
  assert.equal(
    acceptsRequest(
      dockerAccess,
      "192.0.2.20:4100",
      "http://192.0.2.20:4100",
      "::ffff:172.18.0.1",
    ),
    true,
  );
  assert.equal(
    acceptsRequest(
      dockerAccess,
      "node.example-tailnet.ts.net:4100",
      "http://attacker.invalid",
      "::ffff:172.18.0.1",
    ),
    false,
  );
  assert.equal(
    acceptsRequest(
      dockerAccess,
      "unlisted.invalid:4100",
      undefined,
      "::ffff:172.18.0.1",
    ),
    false,
  );
  assert.throws(
    () => networkAccess({ DASH_PUBLIC_ORIGINS: "https://*.example.com" }),
    /exact/,
  );
  assert.throws(
    () => networkAccess({ DASH_PUBLIC_ORIGINS: "https://example.com/sub" }),
    /exact/,
  );
  const publicAccess = networkAccess({
    DASH_BIND_HOST: "0.0.0.0",
    DASH_ALLOW_REMOTE_PEERS: "1",
    DASH_PUBLIC_ORIGINS: "https://home.example.com",
  });
  assert.equal(
    acceptsRequest(
      publicAccess,
      "home.example.com",
      "https://home.example.com",
      "203.0.113.10",
    ),
    true,
  );
  assert.equal(
    acceptsRequest(
      publicAccess,
      "home.example.com",
      "https://attacker.invalid",
      "203.0.113.10",
    ),
    false,
  );
  assert.equal(
    isHttpsOrigin(publicAccess, "home.example.com", "https://home.example.com"),
    true,
  );
  assert.equal(
    isHttpsOrigin(publicAccess, "127.0.0.1:4100", "http://127.0.0.1:4100"),
    false,
  );
});
