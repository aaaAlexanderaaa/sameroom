import { v4 as randomUUID } from "uuid";
import type { Action, Command, Dashboard, Receipt } from "../shared/domain.js";
import type { GuestDashboard } from "../shared/guest.js";

let session = "";

export type SessionInfo =
  { role: "guest" } | { role: "admin"; csrfToken: string };

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function setSessionToken(token: string) {
  session = token;
}

export async function request<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const form = body instanceof FormData;
  const response = await fetch("/api" + path, {
    method: body === undefined ? "GET" : method,
    headers:
      body === undefined
        ? {}
        : {
            "X-Session-Token": session,
            ...(!form ? { "Content-Type": "application/json" } : {}),
          },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok)
    throw new RequestError(
      value.error ?? `HTTP ${response.status}`,
      response.status,
    );
  return value;
}

export async function fetchSession(): Promise<SessionInfo> {
  const info = await request<SessionInfo>("/session");
  session = info.role === "admin" ? info.csrfToken : "";
  return info;
}

export async function loginAdmin(key: string): Promise<{ csrfToken: string }> {
  const result = await request<{ ok: true; csrfToken: string }>(
    "/admin/login",
    { key },
  );
  session = result.csrfToken;
  return { csrfToken: result.csrfToken };
}

export async function logoutAdmin(): Promise<void> {
  await request("/admin/logout", {});
  session = "";
}

export async function fetchGuestState(): Promise<GuestDashboard> {
  return request<GuestDashboard>("/guest/state");
}

export async function initialize(): Promise<Dashboard> {
  const info = await fetchSession();
  if (info.role !== "admin") {
    throw new RequestError("Admin login required.", 403);
  }
  return request<Dashboard>("/state");
}

export async function command(
  action: Action,
  revision: number,
  scope: "home" | "example" = "home",
) {
  const previous = pendingCommand();
  if (previous && pendingScope() !== scope)
    throw new Error("请先返回上次操作的空间，确认保存结果。");
  if (previous && JSON.stringify(previous.action) !== JSON.stringify(action)) {
    throw new Error("上一项操作的结果尚未确认，请先使用“确认上次操作”。");
  }
  const input = previous ?? {
    operationId: randomUUID(),
    expectedRevision: revision,
    issuedAt: new Date().toISOString(),
    action,
  };
  if (sending) throw new Error("操作正在保存，请稍候。");
  // Persist BEFORE the request. A lost response or page reload reuses the exact ID/body.
  sessionStorage.setItem(pendingKey, JSON.stringify(input));
  sessionStorage.setItem(pendingKey + ".scope", scope);
  return retryPending();
}

const pendingKey = "home-atlas.pending-command.v1";
let sending = false;

export function pendingCommand(): Command | undefined {
  const value = sessionStorage.getItem(pendingKey);
  return value ? JSON.parse(value) : undefined;
}

export function pendingScope(): "home" | "example" {
  return sessionStorage.getItem(pendingKey + ".scope") === "example"
    ? "example"
    : "home";
}

export async function retryPending() {
  const input = pendingCommand();
  if (!input) return;
  if (sending) throw new Error("操作正在保存，请稍候。");
  sending = true;
  try {
    const receipt = await request<Receipt>(
      pendingScope() === "example" ? "/world-example/commands" : "/commands",
      input,
    );
    sessionStorage.removeItem(pendingKey);
    return receipt;
  } catch (error) {
    // Validation/conflict/auth failures do not commit. Transport/5xx outcomes stay pending.
    if (error instanceof RequestError && error.status < 500)
      sessionStorage.removeItem(pendingKey);
    throw error;
  } finally {
    sending = false;
  }
}

export interface Generation {
  name: string;
  taskId?: number;
  providerId: "lux3d" | "fixture";
  phase: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  uploadId?: string;
  uploadIds?: string[];
  assets: { url: string; format: string; bytes: number; sha256: string }[];
}

export interface ProviderInfo {
  configured: boolean;
  defaultProvider: string;
  region: string;
  connectionId: string;
}
