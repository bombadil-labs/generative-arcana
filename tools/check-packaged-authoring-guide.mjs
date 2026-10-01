#!/usr/bin/env node
/** Run inside either final container: prove the public stdio surface needs no source checkout. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describeAuthoringGuide, readBuiltAuthoringGuide, SOURCE_ROOT } from "./build-authoring-guide.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
assert.equal(existsSync(join(root, SOURCE_ROOT)), false, "Run this check in the final packaged runtime, without canonical source directories");
const expected = readBuiltAuthoringGuide(root);
const child = spawn(process.execPath, ["--import", "tsx", "src/stdio.ts"], { cwd: join(root, "mcp"), stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map();
let nextId = 0;
let stderr = "";
child.stderr.on("data", (data) => { stderr += String(data); });
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  try {
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  } catch (error) { failAll(error); }
});
child.on("error", failAll);
child.on("exit", (code) => { if (pending.size) failAll(new Error(`Packaged stdio exited (${code}): ${stderr}`)); });
function failAll(error) {
  for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(error); }
  pending.clear();
}
function call(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Packaged ${method} timed out: ${stderr}`)); }, 15_000);
    pending.set(id, { resolve, reject, timeout });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}
try {
  await call("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "packaged-guide-check", version: "1" } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const tools = await call("tools/list");
  assert.ok(tools.tools.some((tool) => tool.name === "get_deck_authoring_guide"));
  const guide = await call("tools/call", { name: "get_deck_authoring_guide", arguments: {} });
  assert.equal(guide.isError, undefined);
  assert.equal(guide.content[0].text, expected.text);
  const sections = describeAuthoringGuide(expected);
  const toc = await call("tools/call", { name: "get_deck_authoring_guide", arguments: { toc: true } });
  assert.equal(toc.isError, undefined);
  assert.equal(toc.structuredContent.mode, "toc");
  assert.equal(toc.structuredContent.sha256, expected.metadata.sha256);
  assert.deepEqual(toc.structuredContent.files, sections.map(({ text: _text, ...file }) => file));
  assert.ok(toc.content[0].text.length < expected.text.length / 10);
  const selection = await call("tools/call", { name: "get_deck_authoring_guide", arguments: { files: sections.map(({ path }) => path).reverse() } });
  assert.equal(selection.isError, undefined);
  assert.equal(selection.content[0].text, sections.map(({ text }) => text).join("\n"));
  assert.deepEqual(selection.structuredContent.selectedPaths, sections.map(({ path }) => path));
  const first = sections[0];
  const chunk = await call("tools/call", { name: "get_deck_authoring_guide", arguments: { offset: first.section.offset, maxChars: first.section.chars } });
  assert.equal(chunk.content[0].text, first.text);
  const resource = await call("resources/read", { uri: "arcana://authoring/guide" });
  assert.equal(resource.contents[0].text, expected.text);
  console.log(`Packaged stdio full guide/TOC/file batches/legacy range/resource verified: ${expected.metadata.files.length} source files, ${expected.metadata.byteLength} bytes.`);
} finally {
  lines.close();
  child.stdin.end();
  child.kill("SIGTERM");
}
