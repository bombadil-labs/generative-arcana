// Compile the pure data boundary with the project's existing TypeScript, then run Node's tests.
// No test-framework dependency and no changes to the application's ESM module format.
const { execFileSync } = require("node:child_process");
const { mkdirSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const root = resolve(__dirname, "..");
const output = resolve(root, ".test-build");
try {
  rmSync(output, { recursive: true, force: true });
  execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.test.json"], { cwd: root, stdio: "inherit" });
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "package.json"), '{"type":"commonjs"}');
  const tests = readdirSync(resolve(root, "tests")).filter((f) => f.endsWith(".test.cjs")).sort().map((f) => `tests/${f}`);
  execFileSync(process.execPath, ["--test", ...tests], { cwd: root, stdio: "inherit" });
} catch (error) {
  process.exitCode = typeof error.status === "number" ? error.status : 1;
} finally {
  rmSync(output, { recursive: true, force: true });
}
