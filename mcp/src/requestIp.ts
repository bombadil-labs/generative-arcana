import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";

/** Trust Vercel's overwritten header only on its own runtime; otherwise use the socket. */
export function requestClientIp(req: Pick<IncomingMessage, "headers" | "socket">, vercel = process.env.VERCEL === "1"): string {
  if (vercel) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && isIP(forwarded.trim())) return forwarded.trim();
    // No arbitrary list parsing: malformed/ambiguous proxy identity shares the peer's bucket.
  }
  return req.socket.remoteAddress ?? "unknown";
}
