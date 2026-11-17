import { z } from "zod";

export const BUILTIN_ICON_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const CUSTOM_ICON_URL_RE = /^\/api\/icons\/[a-f0-9]{64}$/;

export const iconRefSchema = z.union([
  z.string().regex(BUILTIN_ICON_KEY_RE),
  z.string().regex(CUSTOM_ICON_URL_RE),
]);

export interface BuiltinServiceIcon {
  key: string;
  name: string;
  url: string;
  color: string;
  keywords: string[];
}

export const builtinServiceIcons: BuiltinServiceIcon[] = [
  {
    key: "nginx-proxy-manager",
    name: "Nginx Proxy Manager",
    url: "/icons/services/nginx-proxy-manager.svg",
    color: "#38b27b",
    keywords: ["nginx proxy manager", "nginx-proxy", "npm-edge", "npm"],
  },
  {
    key: "portainer",
    name: "Portainer",
    url: "/icons/services/portainer.svg",
    color: "#38a3eb",
    keywords: ["portainer"],
  },
  {
    key: "gitea",
    name: "Gitea",
    url: "/icons/services/gitea.svg",
    color: "#60b85f",
    keywords: ["gitea"],
  },
  {
    key: "vaultwarden",
    name: "Vaultwarden",
    url: "/icons/services/vaultwarden.svg",
    color: "#4c8bf5",
    keywords: ["vaultwarden", "bitwarden"],
  },
  {
    key: "trilium",
    name: "TriliumNext",
    url: "/icons/services/trilium.svg",
    color: "#38b89a",
    keywords: ["trilium", "triliumnext"],
  },
  {
    key: "lobehub",
    name: "LobeHub",
    url: "/icons/services/lobehub.svg",
    color: "#f59e0b",
    keywords: ["lobehub", "lobe"],
  },
  {
    key: "n8n",
    name: "n8n",
    url: "/icons/services/n8n.svg",
    color: "#ea5b66",
    keywords: ["n8n"],
  },
  {
    key: "nocodb",
    name: "NocoDB",
    url: "/icons/services/nocodb.svg",
    color: "#6c72f0",
    keywords: ["nocodb"],
  },
  {
    key: "syncthing",
    name: "Syncthing",
    url: "/icons/services/syncthing.svg",
    color: "#33a3dc",
    keywords: ["syncthing"],
  },
  {
    key: "wallos",
    name: "Wallos",
    url: "/icons/services/wallos.svg",
    color: "#9f7aea",
    keywords: ["wallos"],
  },
  {
    key: "postgresql",
    name: "PostgreSQL",
    url: "/icons/services/postgresql.svg",
    color: "#5b8cc4",
    keywords: ["postgresql", "postgres", "paradedb"],
  },
  {
    key: "proxmox",
    name: "Proxmox",
    url: "/icons/services/proxmox.svg",
    color: "#e67028",
    keywords: ["proxmox", "pve"],
  },
  {
    key: "pihole",
    name: "Pi-hole",
    url: "/icons/services/pihole.svg",
    color: "#e54b4b",
    keywords: ["pi-hole", "pihole"],
  },
  {
    key: "home-assistant",
    name: "Home Assistant",
    url: "/icons/services/home-assistant.svg",
    color: "#29b6f6",
    keywords: ["home assistant", "home-assistant", "hass"],
  },
  {
    key: "grafana",
    name: "Grafana",
    url: "/icons/services/grafana.svg",
    color: "#f48c25",
    keywords: ["grafana"],
  },
  {
    key: "truenas",
    name: "TrueNAS",
    url: "/icons/services/truenas.svg",
    color: "#33b5e5",
    keywords: ["truenas"],
  },
  {
    key: "docker",
    name: "Docker",
    url: "/icons/services/docker.svg",
    color: "#2496ed",
    keywords: ["docker", "orbstack"],
  },
  {
    key: "redis",
    name: "Redis",
    url: "/icons/services/redis.svg",
    color: "#e24339",
    keywords: ["redis", "valkey"],
  },
  {
    key: "uptime-kuma",
    name: "Uptime Kuma",
    url: "/icons/services/uptime-kuma.svg",
    color: "#5cdd8b",
    keywords: ["uptime kuma", "uptime-kuma"],
  },
  {
    key: "tailscale",
    name: "Tailscale",
    url: "/icons/services/tailscale.svg",
    color: "#6a8be2",
    keywords: ["tailscale", "headscale"],
  },
  {
    key: "cloudflare",
    name: "Cloudflare",
    url: "/icons/services/cloudflare.svg",
    color: "#f38020",
    keywords: ["cloudflare", "cf-tunnel"],
  },
];

const byKey = new Map(builtinServiceIcons.map((item) => [item.key, item]));

export interface ResolvedServiceIcon {
  src?: string;
  key?: string;
  color?: string;
  custom: boolean;
}

export function resolveServiceIcon(input: {
  icon?: string;
  serviceId?: string;
  label?: string;
}): ResolvedServiceIcon {
  if (input.icon) {
    if (CUSTOM_ICON_URL_RE.test(input.icon)) {
      return { src: input.icon, custom: true };
    }
    const exact = byKey.get(input.icon);
    if (exact) {
      return { src: exact.url, key: exact.key, color: exact.color, custom: false };
    }
  }
  const haystack = `${input.serviceId ?? ""} ${input.label ?? ""}`.toLowerCase();
  if (haystack.trim()) {
    for (const item of builtinServiceIcons) {
      if (item.keywords.some((kw) => haystack.includes(kw))) {
        return { src: item.url, key: item.key, color: item.color, custom: false };
      }
    }
  }
  return { custom: false };
}
