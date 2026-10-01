#!/usr/bin/env node
/** Build transport-ready text from canonical sources, never hand-maintained copies. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SOURCE_ROOT = "skill/generative-arcana";
export const SUPPORT_DOCS = [
  "docs/contracts-and-readings.md",
  "docs/deck-manifest.md",
  "docs/schema-v2.md",
  "docs/visual-grammar.md",
];
// These are operational navigation, not instructions/schema/examples for authoring.
// Any new out-of-package Markdown reference must be reviewed rather than silently skipped.
export const EXCLUDED_NAVIGATION = ["docs/authoring-hosts.md", "docs/production-launch-checklist.md"];
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".svg", ".ts", ".js", ".mjs", ".py"]);
const MAX_SOURCE_BYTES = 1_000_000;
const MAX_BUNDLE_BYTES = 2_000_000;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const digest = (value) => createHash("sha256").update(value).digest("hex");

/** Resolve only reviewed repository-relative paths; reject symlinks at every component. */
export function checkedPath(root, path) {
  assert.equal(typeof path, "string");
  assert.ok(path && /^[A-Za-z0-9_./-]+$/.test(path), `Unsafe source path: ${path}`);
  assert.ok(!posix.isAbsolute(path) && path.split("/").every((part) => part && part !== "." && part !== ".."), `Unsafe source path: ${path}`);
  let current = realpathSync(root);
  const realRoot = current;
  for (const part of path.split("/")) {
    current = join(current, part);
    assert.ok(!lstatSync(current).isSymbolicLink(), `Source symlink is forbidden: ${path}`);
  }
  const location = realpathSync(current);
  const within = relative(realRoot, location);
  assert.ok(within && !within.startsWith("..") && !posix.isAbsolute(within), `Source escaped repository: ${path}`);
  return location;
}

function sourceFiles(root, directory) {
  const path = checkedPath(root, directory);
  assert.ok(lstatSync(path).isDirectory(), `Not a source directory: ${directory}`);
  return readdirSync(path).sort().flatMap((name) => {
    const relativePath = `${directory}/${name}`;
    const stat = lstatSync(checkedPath(root, relativePath));
    if (stat.isDirectory()) return sourceFiles(root, relativePath);
    assert.ok(stat.isFile() && TEXT_EXTENSIONS.has(extname(name)), `Unsupported source file: ${relativePath}`);
    return [relativePath];
  });
}

/** Verify transitive prose references, including package-root, sibling and strategy shorthand. */
export function validateReferences(sources) {
  const paths = new Set(sources.map((source) => source.path));
  for (const source of sources) {
    if (!source.path.endsWith(".md")) continue;
    const references = [...source.text.matchAll(/(?:^|[\s`(\[])((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.md)(?=[\s`#)\]]|$)/gm)].map((match) => match[1]);
    // Explicit linked examples/instructions are dependencies regardless of text extension.
    for (const match of source.text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1].split("#")[0];
      if (target && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) references.push(target);
    }
    for (const target of references) {
      assert.ok(!target.startsWith("/") && !target.includes("\\") && !target.split("/").includes(".."), `Unsafe reference in ${source.path}: ${target}`);
      const candidates = [target, posix.join(posix.dirname(source.path), target), `${SOURCE_ROOT}/${target}`, `${SOURCE_ROOT}/strategies/${target}`];
      // SKILL.md lists sibling strategy basenames in stage-specific prose; include all matches.
      if (!target.includes("/")) candidates.push(...[...paths].filter((path) => path.startsWith(`${SOURCE_ROOT}/`) && posix.basename(path) === target));
      assert.ok(candidates.some((path) => paths.has(path) || EXCLUDED_NAVIGATION.includes(path)), `Unbundled authoring reference in ${source.path}: ${target}`);
    }
  }
}

export function buildAuthoringGuide(root = repositoryRoot) {
  const entrypoint = `${SOURCE_ROOT}/SKILL.md`;
  const packageFiles = sourceFiles(root, SOURCE_ROOT);
  assert.ok(packageFiles.includes(entrypoint), "Portable SKILL.md is missing");
  const ordered = [entrypoint, ...packageFiles.filter((path) => path !== entrypoint).sort(), ...SUPPORT_DOCS];
  const sources = ordered.map((path) => {
    const data = readFileSync(checkedPath(root, path));
    assert.ok(data.length <= MAX_SOURCE_BYTES, `Source is too large: ${path}`);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
    assert.ok(!text.includes("\0"), `Binary source is forbidden: ${path}`);
    return { path, text, bytes: data.length, sha256: digest(data) };
  });
  validateReferences(sources);
  const files = sources.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  const sourceDigest = digest(JSON.stringify(files));
  const text = [
    "GENERATIVE ARCANA — COMPLETE AUTHORING GUIDE",
    `Source inventory SHA-256: ${sourceDigest}`,
    `Files: ${files.length}. Each filename-delimited section reproduces its canonical source verbatim.`,
    "Package: all text sources under skill/generative-arcana; supporting authoring contracts follow.",
    "Operational navigation and implementation-code references are not authoring dependencies and are not embedded.",
    "",
    ...sources.map((source) => `===== BEGIN FILE: ${source.path} =====\n${source.text}\n===== END FILE: ${source.path} =====\n`),
  ].join("\n");
  const byteLength = Buffer.byteLength(text);
  assert.ok(byteLength <= MAX_BUNDLE_BYTES, "Authoring guide exceeds bundle size budget");
  return { text, metadata: { formatVersion: 1, sourceRoot: SOURCE_ROOT, sourceDigest, sha256: digest(text), byteLength, files } };
}

export function readBuiltAuthoringGuide(root = repositoryRoot) {
  const text = readFileSync(checkedPath(root, "mcp/generated/authoring-guide.txt"), "utf8");
  const metadata = JSON.parse(readFileSync(checkedPath(root, "mcp/generated/authoring-guide.json"), "utf8"));
  assert.equal(metadata.formatVersion, 1, "Unsupported authoring guide format");
  assert.equal(metadata.sourceRoot, SOURCE_ROOT);
  assert.ok(Array.isArray(metadata.files) && metadata.files.length > 0, "Missing source inventory");
  assert.equal(metadata.sourceDigest, digest(JSON.stringify(metadata.files)), "Source inventory digest mismatch");
  assert.equal(metadata.byteLength, Buffer.byteLength(text), "Authoring guide length mismatch");
  assert.equal(metadata.sha256, digest(text), "Authoring guide digest mismatch");
  return { text, metadata };
}

/** Source checkout: read current canonical files. Packaged runtime: read verified build output only. */
export function loadAuthoringGuide(root = repositoryRoot) {
  return existsSync(join(root, SOURCE_ROOT)) ? buildAuthoringGuide(root) : readBuiltAuthoringGuide(root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const bundle = buildAuthoringGuide();
  const output = join(repositoryRoot, "mcp/generated");
  if (process.argv.includes("--check")) {
    const built = readBuiltAuthoringGuide();
    assert.deepEqual(built, bundle, "Generated authoring guide is stale; run npm run build --prefix mcp");
  } else {
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "authoring-guide.txt"), bundle.text);
    writeFileSync(join(output, "authoring-guide.json"), `${JSON.stringify(bundle.metadata, null, 2)}\n`);
  }
  console.log(`Authoring guide: ${bundle.metadata.files.length} files, ${bundle.metadata.byteLength} bytes, sha256 ${bundle.metadata.sha256}`);
}
