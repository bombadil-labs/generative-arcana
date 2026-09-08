import { createHash } from "node:crypto";
import type { ArcanaToolName } from "../../app/src/mcp/ArcanaToolAdapter";

export interface ArcanaToolCallEvent {
  tool: ArcanaToolName;
  ok: boolean;
  durationMs: number;
}

export type ArcanaToolCallObserver = (event: ArcanaToolCallEvent) => void;

export interface ArcanaLogContext {
  transport: "stdio" | "http";
  principalId?: string | null;
}

/** JSON stderr observer that intentionally records no tool arguments or user-authored content. */
export function jsonToolCallObserver(context: ArcanaLogContext): ArcanaToolCallObserver {
  const principal = context.principalId ? opaquePrincipalLogId(context.principalId) : "anonymous";
  return (event) => {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      event: "mcp_tool_call",
      transport: context.transport,
      principal,
      tool: event.tool,
      ok: event.ok,
      durationMs: event.durationMs,
    }));
  };
}

export function opaquePrincipalLogId(principalId: string): string {
  return createHash("sha256").update(principalId, "utf8").digest("hex").slice(0, 12);
}
