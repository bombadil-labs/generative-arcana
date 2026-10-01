import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export async function startReadinessHttp(overrides: NodeJS.ProcessEnv = {}, imports: string[] = []) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("MCP_") || name.startsWith("BETTER_AUTH_") || name.startsWith("SMTP_") || name.startsWith("RESEND_") || name.startsWith("ARCANA_") || name.startsWith("VERCEL") || name === "DATABASE_URL") delete env[name];
  }
  const child = spawn(process.execPath, [
    ...imports.flatMap((path) => ["--import", path]), "--import", "tsx",
    fileURLToPath(new URL("./fixtures/readiness-http.ts", import.meta.url)),
  ], {
    env: { ...env, PORT: "3000", ...overrides, HOST: "127.0.0.1" },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  try {
    const base = await waitForListening(child, () => stderr);
    return { child, base };
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

export function waitForListening(child: ChildProcess, stderr: () => string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const fail = (message: string) => {
      cleanup();
      reject(new Error(`${message}\n${stderr()}`));
    };
    const onMessage = (message: unknown) => {
      const value = message as { type?: unknown; address?: unknown; port?: unknown } | null;
      if (!value || value.type !== "arcana-test-listening" || value.address !== "127.0.0.1" ||
          typeof value.port !== "number" || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
        fail("Invalid HTTP fixture listener message");
        return;
      }
      cleanup();
      resolve(`http://${value.address}:${value.port}`);
    };
    const onError = (error: Error) => fail(`HTTP fixture failed to start: ${error.message}`);
    const onExit = () => fail(`HTTP fixture exited before listening (code=${child.exitCode}, signal=${child.signalCode})`);
    const timer = setTimeout(() => fail("Timed out waiting for HTTP fixture listener"), timeoutMs);
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
    if (child.exitCode !== null || child.signalCode !== null) onExit();
  });
}

export async function stopChild(child: ChildProcess, graceMs = 1_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const timer = setTimeout(() => { child.kill("SIGKILL"); }, graceMs);
  try {
    child.kill("SIGTERM");
    // Await the actual exit even when SIGTERM times out, before releasing fixtures.
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
