import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArcanaHostState, ArcanaHostStateRepository } from "./hostState";

/**
 * Alpha-grade durable repository: one JSON file per opaque principal scope.
 *
 * Scope ids are hashed before touching the filesystem; writes use same-directory temp files + rename
 * so readers never observe partial JSON. A Fly volume or other persistent mount can back `rootDir`.
 */
export class FileArcanaHostStateRepository implements ArcanaHostStateRepository {
  constructor(readonly rootDir: string) {
    if (typeof rootDir !== "string" || !rootDir.trim()) throw new Error("Arcana state root directory must be non-empty.");
  }

  async load(scopeId: string): Promise<unknown | null> {
    const path = this.pathFor(scopeId);
    try {
      return JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch (error) {
      if (isErrno(error, "ENOENT")) return null;
      if (error instanceof SyntaxError) throw new Error(`Persisted Arcana state for ${scopeId} is invalid JSON.`);
      throw error;
    }
  }

  async save(scopeId: string, state: ArcanaHostState): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const target = this.pathFor(scopeId);
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    const body = `${JSON.stringify(state)}\n`;
    try {
      await writeFile(temp, body, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async delete(scopeId: string): Promise<boolean> {
    try {
      await rm(this.pathFor(scopeId));
      return true;
    } catch (error) {
      if (isErrno(error, "ENOENT")) return false;
      throw error;
    }
  }

  private pathFor(scopeId: string): string {
    const key = requireScopeId(scopeId);
    const digest = createHash("sha256").update(key, "utf8").digest("hex");
    return join(this.rootDir, `${digest}.json`);
  }
}

function requireScopeId(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Arcana host scope id must be a non-empty string.");
  return value;
}

function isErrno(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code;
}
