import { isIP } from "node:net";

export interface NetworkAccess {
  bindHost?: "127.0.0.1" | "0.0.0.0";
  allowRemotePeers?: boolean;
  allowedHosts?: string[];
  publicOrigins?: string[];
  tailscaleIP?: string;
  tailscaleHostnames?: string[];
}
function address(value: string) {
  return value.startsWith("::ffff:") ? value.slice(7) : value;
}
function isExactDnsHostname(name: string) {
  return (
    name.length > 0 &&
    name.length <= 253 &&
    name
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}
export function isLoopback(value: string) {
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(address(value));
}
export function isTailscaleIP(value: string) {
  const ip = address(value);
  if (isIP(ip) === 6) return ip.toLowerCase().startsWith("fd7a:115c:a1e0:");
  const parts = ip.split(".").map(Number);
  return (
    isIP(ip) === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
  );
}
export function networkAccess(env: NodeJS.ProcessEnv): NetworkAccess {
  const ip = env.DASH_TAILSCALE_IP?.trim();
  const hostnames = (env.DASH_TAILSCALE_HOSTNAMES ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (ip && !isTailscaleIP(ip))
    throw new Error(
      "DASH_TAILSCALE_IP must be a Tailscale IP, never a wildcard or LAN address.",
    );
  if (hostnames.length && !ip)
    throw new Error("Tailscale hostnames require DASH_TAILSCALE_IP.");
  for (const name of hostnames) {
    if (!isExactDnsHostname(name)) {
      throw new Error(
        "DASH_TAILSCALE_HOSTNAMES must contain exact DNS names without ports or wildcards.",
      );
    }
  }
  const rawBindHost = env.DASH_BIND_HOST?.trim();
  if (rawBindHost && rawBindHost !== "127.0.0.1" && rawBindHost !== "0.0.0.0") {
    throw new Error("DASH_BIND_HOST must be 127.0.0.1 or 0.0.0.0.");
  }
  const rawRemote = env.DASH_ALLOW_REMOTE_PEERS?.trim().toLowerCase();
  const allowRemotePeers = rawRemote === "1" || rawRemote === "true";
  const allowedHosts = (env.DASH_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  for (const entry of allowedHosts) {
    const clean = entry.replace(/^\[|\]$/g, "");
    if (!isIP(clean) && !isExactDnsHostname(clean)) {
      throw new Error(
        "DASH_ALLOWED_HOSTS must contain exact IPs or DNS hostnames without ports or wildcards.",
      );
    }
  }
  const publicOrigins = (env.DASH_PUBLIC_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((entry) => {
      let parsed: URL;
      try {
        parsed = new URL(entry);
      } catch {
        throw new Error(
          "DASH_PUBLIC_ORIGINS must contain exact http(s) origins without paths or wildcards.",
        );
      }
      const cleanHost = parsed.hostname.replace(/^\[|\]$/g, "");
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash ||
        parsed.origin !== entry.toLowerCase() ||
        (!isIP(cleanHost) && !isExactDnsHostname(cleanHost))
      ) {
        throw new Error(
          "DASH_PUBLIC_ORIGINS must contain exact lowercase http(s) origins without paths or wildcards.",
        );
      }
      return parsed.origin;
    });
  return {
    tailscaleIP: ip,
    tailscaleHostnames: hostnames,
    ...(rawBindHost
      ? { bindHost: rawBindHost as "127.0.0.1" | "0.0.0.0" }
      : {}),
    ...(allowRemotePeers ? { allowRemotePeers } : {}),
    ...(allowedHosts.length ? { allowedHosts } : {}),
    ...(publicOrigins.length ? { publicOrigins } : {}),
  };
}
export function acceptsRequest(
  access: NetworkAccess,
  host: string,
  origin: string | undefined,
  peer: string,
) {
  if (
    !isLoopback(peer) &&
    !access.allowRemotePeers &&
    !(access.tailscaleIP && isTailscaleIP(peer))
  )
    return false;
  try {
    const target = new URL(`http://${host}`);
    // Reject credentials, paths and other values that are not an HTTP Host.
    if (
      target.host !== host.toLowerCase() ||
      target.username ||
      target.password ||
      target.pathname !== "/" ||
      target.search ||
      target.hash
    )
      return false;
    const hostname = target.hostname.replace(/^\[|\]$/g, "");
    const allowed =
      isLoopback(hostname) ||
      Boolean(access.allowedHosts?.includes(hostname)) ||
      Boolean(
        access.publicOrigins?.some(
          (entry) => new URL(entry).host === target.host,
        ),
      ) ||
      Boolean(
        access.tailscaleIP &&
        (hostname === access.tailscaleIP ||
          access.tailscaleHostnames?.includes(hostname)),
      );
    if (!allowed) return false;
    if (!origin) return true;
    return (
      origin === target.origin ||
      Boolean(
        access.publicOrigins?.includes(origin) &&
        new URL(origin).host === target.host,
      )
    );
  } catch {
    return false;
  }
}
export function isHttpsOrigin(
  access: NetworkAccess,
  host: string,
  origin: string | undefined,
) {
  const lowerHost = host.toLowerCase();
  if (origin && origin.startsWith("https://")) {
    return Boolean(access.publicOrigins?.includes(origin));
  }
  const hasHttps = Boolean(
    access.publicOrigins?.some(
      (entry) =>
        entry.startsWith("https://") && new URL(entry).host === lowerHost,
    ),
  );
  const hasHttp = Boolean(
    access.publicOrigins?.some(
      (entry) =>
        entry.startsWith("http://") && new URL(entry).host === lowerHost,
    ),
  );
  return hasHttps && !hasHttp;
}
export function displayHost(ip: string) {
  return isIP(ip) === 6 ? `[${ip}]` : ip;
}
