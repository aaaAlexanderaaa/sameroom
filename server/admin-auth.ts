import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { jsonWrite } from "../scripts/lib/store.js";
import { registerSecret } from "../scripts/lib/config.js";

export const adminSessionCookie = "home_admin_session";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const maxActiveSessions = 20;
const attemptWindowMs = 5 * 60 * 1000;
const maxBucketFailures = 5;
const maxGlobalFailures = 25;

interface StoredSession {
  idHash: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}

interface FailureBucket {
  count: number;
  resetAt: number;
}

function sha256Buffer(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256Buffer(a), sha256Buffer(b));
}

export function parseCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    return trimmed.slice(name.length + 1);
  }
  return undefined;
}

export class AdminAuth {
  readonly sessionsPath: string;
  private adminKey = "";
  private sessions: StoredSession[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private failures = new Map<string, FailureBucket>();
  private globalFailures: FailureBucket = {
    count: 0,
    resetAt: Date.now() + attemptWindowMs,
  };

  constructor(
    readonly root: string,
    private explicitKey = process.env.DASH_ADMIN_KEY?.trim(),
  ) {
    this.sessionsPath = join(root, "data/private/admin-sessions.json");
  }

  async init(): Promise<{ keyPath: string; source: "env" | "file" }> {
    const privateDir = join(this.root, "data/private");
    await mkdir(privateDir, { recursive: true, mode: 0o700 });
    const keyPath = join(privateDir, "admin-token");
    let source: "env" | "file" = "file";
    if (this.explicitKey) {
      if (this.explicitKey.length < 12) {
        throw new Error(
          "DASH_ADMIN_KEY must be at least 12 characters for public safety.",
        );
      }
      this.adminKey = this.explicitKey;
      source = "env";
    } else {
      try {
        this.adminKey = (await readFile(keyPath, "utf8")).trim();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        this.adminKey = randomBytes(32).toString("hex");
        await writeFile(keyPath, this.adminKey + "\n", {
          mode: 0o600,
          flag: "wx",
        });
      }
      if (this.adminKey.length < 12) {
        throw new Error(
          "Invalid local admin token file. Restore a valid token before starting.",
        );
      }
    }
    registerSecret(this.adminKey);
    await this.loadSessions();
    return { keyPath, source };
  }

  private async loadSessions() {
    try {
      const parsed = JSON.parse(
        await readFile(this.sessionsPath, "utf8"),
      ) as unknown;
      const now = Date.now();
      if (Array.isArray(parsed)) {
        this.sessions = parsed.filter(
          (item): item is StoredSession =>
            Boolean(item) &&
            typeof item.idHash === "string" &&
            typeof item.csrfToken === "string" &&
            typeof item.createdAt === "number" &&
            typeof item.expiresAt === "number" &&
            item.expiresAt > now,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.sessions = [];
    }
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }

  private pruneExpired(now = Date.now()) {
    this.sessions = this.sessions
      .filter((session) => session.expiresAt > now)
      .slice(-maxActiveSessions);
  }

  private checkRateLimit(bucketKey: string, now: number): number | undefined {
    if (this.globalFailures.resetAt <= now) {
      this.globalFailures = { count: 0, resetAt: now + attemptWindowMs };
    }
    if (this.globalFailures.count >= maxGlobalFailures) {
      return Math.max(1, Math.ceil((this.globalFailures.resetAt - now) / 1000));
    }
    const bucket = this.failures.get(bucketKey);
    if (bucket) {
      if (bucket.resetAt <= now) this.failures.delete(bucketKey);
      else if (bucket.count >= maxBucketFailures) {
        return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      }
    }
    return undefined;
  }

  private recordFailure(bucketKey: string, now: number) {
    this.globalFailures.count++;
    const current = this.failures.get(bucketKey);
    if (!current || current.resetAt <= now) {
      this.failures.set(bucketKey, {
        count: 1,
        resetAt: now + attemptWindowMs,
      });
    } else {
      current.count++;
    }
  }

  async login(
    candidate: string,
    bucketKey: string,
  ): Promise<
    | { ok: true; sessionId: string; csrfToken: string; maxAgeMs: number }
    | { ok: false; status: 403 | 429; retryAfterSeconds?: number }
  > {
    const now = Date.now();
    const retryAfterSeconds = this.checkRateLimit(bucketKey, now);
    if (retryAfterSeconds !== undefined) {
      return { ok: false, status: 429, retryAfterSeconds };
    }
    if (!constantTimeEqual(candidate.trim(), this.adminKey)) {
      this.recordFailure(bucketKey, now);
      return { ok: false, status: 403 };
    }
    this.failures.delete(bucketKey);
    const sessionId = randomBytes(32).toString("hex");
    const csrfToken = randomBytes(32).toString("hex");
    registerSecret(sessionId);
    registerSecret(csrfToken);
    await this.serialize(async () => {
      this.pruneExpired(now);
      this.sessions.push({
        idHash: sha256Hex(sessionId),
        csrfToken,
        createdAt: now,
        expiresAt: now + sessionTtlMs,
      });
      this.pruneExpired(now);
      await jsonWrite(this.sessionsPath, this.sessions);
    });
    return { ok: true, sessionId, csrfToken, maxAgeMs: sessionTtlMs };
  }

  authenticateCookie(
    cookieHeader: string | undefined,
  ): { csrfToken: string } | undefined {
    const raw = parseCookie(cookieHeader, adminSessionCookie);
    if (!raw) return undefined;
    const hash = sha256Hex(raw);
    const now = Date.now();
    const matched = this.sessions.find(
      (session) => session.idHash === hash && session.expiresAt > now,
    );
    return matched ? { csrfToken: matched.csrfToken } : undefined;
  }

  async logout(cookieHeader: string | undefined): Promise<void> {
    const raw = parseCookie(cookieHeader, adminSessionCookie);
    if (!raw) return;
    const hash = sha256Hex(raw);
    await this.serialize(async () => {
      const before = this.sessions.length;
      this.sessions = this.sessions.filter(
        (session) => session.idHash !== hash,
      );
      this.pruneExpired();
      if (this.sessions.length !== before) {
        await jsonWrite(this.sessionsPath, this.sessions);
      }
    });
  }
}
