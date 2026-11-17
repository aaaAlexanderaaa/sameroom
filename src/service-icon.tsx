import {
  ArrowLeftRight,
  Box,
  Cloud,
  Cpu,
  Database,
  Globe,
  HardDrive,
  Laptop,
  Plug,
  Router,
  Server,
} from "lucide-react";
import { resolveServiceIcon } from "../shared/icons.js";

export type ServiceKind = "service" | "database" | "gateway" | "external";

export interface IconLibraryEntry {
  id: string;
  name: string;
  url: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  createdAt: string;
}

export interface BuiltinIconEntry {
  key: string;
  name: string;
  url: string;
  color: string;
}

export interface IconsCatalogResponse {
  builtin: BuiltinIconEntry[];
  library: IconLibraryEntry[];
}

export function ServiceBadgeIcon({
  icon,
  serviceId,
  label,
  kind = "service",
  size = 18,
  className = "",
}: {
  icon?: string;
  serviceId?: string;
  label?: string;
  kind?: ServiceKind;
  size?: number;
  className?: string;
}) {
  const resolved = resolveServiceIcon({ icon, serviceId, label });
  if (resolved.src) {
    return (
      <span
        className={`service-icon-frame is-image ${className}`.trim()}
        style={{ width: size, height: size }}
      >
        <img
          src={resolved.src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          draggable={false}
          className="service-icon-img"
        />
      </span>
    );
  }
  const fallbackSize = Math.max(12, Math.round(size * 0.72));
  const Fallback =
    kind === "database"
      ? Database
      : kind === "gateway"
        ? ArrowLeftRight
        : kind === "external"
          ? Globe
          : Box;
  return (
    <span
      className={`service-icon-frame is-fallback is-${kind} ${className}`.trim()}
      style={{ width: size, height: size }}
    >
      <Fallback size={fallbackSize} strokeWidth={1.9} />
    </span>
  );
}

export function HostBadgeIcon({
  remote,
  label,
  provider,
  assetKind,
  tags,
  color,
  size = 14,
}: {
  remote: boolean;
  label: string;
  provider?: string;
  assetKind?: string;
  tags?: string[];
  color: string;
  size?: number;
}) {
  if (remote) {
    const cloudMatch = resolveServiceIcon({
      label: `${provider ?? ""} ${label}`,
    });
    if (cloudMatch.src) {
      return (
        <span
          className="cyber-host-badge is-image"
          style={{ borderColor: color }}
        >
          <img
            src={cloudMatch.src}
            alt=""
            width={size}
            height={size}
            draggable={false}
          />
        </span>
      );
    }
    return (
      <span className="cyber-host-badge" style={{ color, borderColor: color }}>
        <Cloud size={size} className="cyber-cloud-icon" />
      </span>
    );
  }

  const hint = `${assetKind ?? ""} ${label} ${(tags ?? []).join(" ")}`.toLowerCase();
  const Icon =
    assetKind === "laptop" || hint.includes("macbook") || hint.includes("laptop")
      ? Laptop
      : assetKind === "plug" || hint.includes("plug") || hint.includes("插座")
        ? Plug
        : hint.includes("nas") || hint.includes("truenas") || hint.includes("storage")
          ? HardDrive
          : hint.includes("router") ||
              hint.includes("gateway") ||
              hint.includes("route") ||
              hint.includes("路由")
            ? Router
            : assetKind === "mini-pc" ||
                assetKind === "mac-mini" ||
                assetKind === "single-board" ||
                hint.includes("mini") ||
                hint.includes("n100") ||
                hint.includes("n150")
              ? Cpu
              : Server;

  return (
    <span className="cyber-host-badge" style={{ color, borderColor: color }}>
      <Icon size={size} />
    </span>
  );
}
