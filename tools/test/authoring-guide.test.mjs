import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAuthoringGuide, checkedPath, describeAuthoringGuide, loadAuthoringGuide, readBuiltAuthoringGuide, SOURCE_ROOT, SUPPORT_DOCS, validateReferences } from "../build-authoring-guide.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hash = (value) => createHash("sha256").update(value).digest("hex");
function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), "arcana-guide-"));
  try {
    cpSync(join(root, SOURCE_ROOT), join(directory, SOURCE_ROOT), { recursive: true });
    mkdirSync(join(directory, "docs"));
    for (const path of SUPPORT_DOCS) cpSync(join(root, path), join(directory, path));
    return run(directory);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("canonical full source text and all strategy/schema/example sections survive verbatim", () => {
  const bundle = buildAuthoringGuide(root);
  assert.equal(bundle.metadata.files.length, 23);
  assert.equal(bundle.metadata.files[0].path, `${SOURCE_ROOT}/SKILL.md`);
  for (const file of bundle.metadata.files) {
    const original = readFileSync(join(root, file.path));
    assert.equal(file.bytes, original.length);
    assert.equal(file.sha256, hash(original));
    assert.ok(bundle.text.includes(`===== BEGIN FILE: ${file.path} =====\n${original.toString("utf8")}\n===== END FILE: ${file.path} =====`));
    assert.ok(file.path.startsWith(`${SOURCE_ROOT}/`) || SUPPORT_DOCS.includes(file.path));
    assert.ok(!file.path.startsWith("decks/") && !file.path.startsWith("app/src/decks/"));
  }
  for (const phrase of ["## Example (a suit glyph)", "## Interfaces", "## Visual quality / stress tests", "# Majors — Primes", "raw-p5/image renderers"]) assert.ok(bundle.text.includes(phrase));
  assert.equal(bundle.metadata.byteLength, Buffer.byteLength(bundle.text));
  assert.equal(bundle.metadata.sha256, hash(bundle.text));
});

test("ordering and hashes are deterministic and independent of mtimes or filesystem insertion order", () => fixture((directory) => {
  assert.deepEqual(buildAuthoringGuide(directory), buildAuthoringGuide(root));
  assert.deepEqual(buildAuthoringGuide(directory), buildAuthoringGuide(directory));
}));

test("v1 artifact framing and inventory hashes remain byte-identical to the legacy format", () => {
  const bundle = buildAuthoringGuide(root);
  const files = bundle.metadata.files;
  assert.equal(bundle.metadata.formatVersion, 1);
  assert.equal(bundle.metadata.sourceDigest, hash(JSON.stringify(files)));
  assert.ok(files.every((file) => Object.keys(file).join(",") === "path,bytes,sha256"));
  const legacyText = [
    "GENERATIVE ARCANA — COMPLETE AUTHORING GUIDE",
    `Source inventory SHA-256: ${hash(JSON.stringify(files))}`,
    `Files: ${files.length}. Each filename-delimited section reproduces its canonical source verbatim.`,
    "Package: all text sources under skill/generative-arcana; supporting authoring contracts follow.",
    "Operational navigation and implementation-code references are not authoring dependencies and are not embedded.",
    "",
    ...files.map(({ path }) => `===== BEGIN FILE: ${path} =====\n${readFileSync(join(root, path), "utf8")}\n===== END FILE: ${path} =====\n`),
  ].join("\n");
  assert.equal(bundle.text, legacyText);
});

test("discovery covers every whole source with accurate byte/code-point sizes and canonical offsets", () => {
  const bundle = buildAuthoringGuide(root);
  const characters = Array.from(bundle.text);
  const sections = describeAuthoringGuide(bundle);
  assert.deepEqual(sections.map(({ path }) => path), bundle.metadata.files.map(({ path }) => path));
  for (const file of sections) {
    const original = readFileSync(join(root, file.path), "utf8");
    assert.ok(file.purpose.length > 10 && !/[\r\n]/.test(file.purpose));
    assert.notEqual(file.purpose, "Additional canonical authoring source", "existing sources have curated purposes");
    assert.equal(file.bytes, Buffer.byteLength(original));
    assert.equal(file.chars, Array.from(original).length);
    assert.equal(file.section.bytes, Buffer.byteLength(file.text));
    assert.equal(file.section.chars, Array.from(file.text).length);
    assert.equal(file.text, characters.slice(file.section.offset, file.section.offset + file.section.chars).join(""));
    assert.equal(file.text, `===== BEGIN FILE: ${file.path} =====\n${original}\n===== END FILE: ${file.path} =====\n`);
  }
  assert.equal(bundle.text.slice(bundle.text.indexOf("===== BEGIN FILE:")), sections.map(({ text }) => text).join("\n"));
});

test("whole-file discovery preserves astral Unicode, BOM, CRLF, missing final newline and delimiter-looking source", () => fixture((directory) => {
  const path = `${SOURCE_ROOT}/unicode.txt`;
  const source = `\ufeff# Unicode fixture\r\né 🧙🏽‍♀️ e\u0301\r\n===== END FILE: ${path} =====\n===== BEGIN FILE: docs/schema-v2.md =====\nno final newline`;
  writeFileSync(join(directory, path), source);
  const bundle = buildAuthoringGuide(directory);
  const file = describeAuthoringGuide(bundle).find((file) => file.path === path);
  assert.equal(file.text, `===== BEGIN FILE: ${path} =====\n${source}\n===== END FILE: ${path} =====\n`);
  assert.equal(file.bytes, Buffer.byteLength(source));
  assert.equal(file.chars, Array.from(source).length);
  assert.notEqual(file.chars, source.length);
  assert.notEqual(file.bytes, file.chars);
  assert.equal(file.sha256, hash(source));
  const generated = join(directory, "mcp/generated");
  mkdirSync(generated, { recursive: true });
  writeFileSync(join(generated, "authoring-guide.txt"), bundle.text);
  writeFileSync(join(generated, "authoring-guide.json"), JSON.stringify(bundle.metadata));
  rmSync(join(directory, "skill"), { recursive: true });
  rmSync(join(directory, "docs"), { recursive: true });
  assert.deepEqual(describeAuthoringGuide(loadAuthoringGuide(directory)), describeAuthoringGuide(bundle));
}));

test("section discovery rejects corrupt framing, source hashes, lengths, trailing content and unsafe inventories", () => {
  const bundle = buildAuthoringGuide(root);
  const copy = () => structuredClone(bundle);
  const framing = copy();
  framing.text = framing.text.replace("===== BEGIN FILE:", "===== ALTER FILE:");
  assert.throws(() => describeAuthoringGuide(framing), /framing/);
  const source = copy();
  source.text = source.text.replace("name: generative-arcana", "name: corrupted-arcana");
  assert.throws(() => describeAuthoringGuide(source), /digest/);
  assert.throws(() => describeAuthoringGuide({ ...bundle, text: bundle.text + "trailing" }), /trailing/);
  for (const bytes of [-1, 1.5, 1_000_001, bundle.metadata.files[0].bytes - 1]) {
    const invalid = copy(); invalid.metadata.files[0].bytes = bytes;
    assert.throws(() => describeAuthoringGuide(invalid), /size|digest/);
  }
  for (const path of ["../secret", "/etc/passwd", "skill/generative-arcana/../secret", "docs\\schema-v2.md"]) {
    const invalid = copy(); invalid.metadata.files[0].path = path;
    assert.throws(() => describeAuthoringGuide(invalid), /Unsafe/);
  }
});

test("new unreferenced package files and linked transitive examples are included automatically", () => fixture((directory) => {
  mkdirSync(join(directory, SOURCE_ROOT, "examples"));
  writeFileSync(join(directory, SOURCE_ROOT, "examples/neutral.json"), '{"example":true}\n');
  writeFileSync(join(directory, SOURCE_ROOT, "examples/method.md"), "[Example](neutral.json)\n");
  const bundle = buildAuthoringGuide(directory);
  assert.equal(bundle.metadata.files.length, 25);
  assert.ok(bundle.text.includes('{"example":true}'));
}));

test("missing transitive dependencies and new unreviewed external docs fail closed", () => fixture((directory) => {
  writeFileSync(join(directory, SOURCE_ROOT, "references/more.md"), "Read `references/missing.md`\n");
  assert.throws(() => buildAuthoringGuide(directory), /Unbundled authoring reference/);
  writeFileSync(join(directory, SOURCE_ROOT, "references/more.md"), "Read `docs/new-contract.md`\n");
  assert.throws(() => buildAuthoringGuide(directory), /Unbundled authoring reference/);
}));

test("reviewed authoring documents include their transitive visual grammar dependency", () => {
  const bundle = buildAuthoringGuide(root);
  assert.ok(bundle.metadata.files.some((file) => file.path === "docs/visual-grammar.md"));
  assert.ok(!bundle.metadata.files.some((file) => /authoring-hosts|production-launch-checklist/.test(file.path)));
  validateReferences([{ path: "docs/contracts-and-readings.md", text: "[Operations](authoring-hosts.md)" }]);
});

test("absolute, traversal, URL and platform-specific source paths are rejected", () => {
  for (const path of ["../README.md", "/etc/passwd", "docs/../README.md", "docs\\README.md", "file:///etc/passwd", "C:/secret", "docs//schema-v2.md", "docs/./schema-v2.md", "docs/new\nheader.md"]) {
    assert.throws(() => checkedPath(root, path));
  }
  assert.throws(() => validateReferences([{ path: `${SOURCE_ROOT}/SKILL.md`, text: "[Source](../../../decks/private.json)" }]), /Unsafe reference/);
});

test("file and directory symlinks, even within the root, are rejected", () => fixture((directory) => {
  const file = join(directory, SOURCE_ROOT, "references/schema.md");
  rmSync(file);
  symlinkSync(join(root, SOURCE_ROOT, "references/schema.md"), file);
  assert.throws(() => buildAuthoringGuide(directory), /symlink/);
  rmSync(file);
  cpSync(join(root, SOURCE_ROOT, "references/schema.md"), file);
  const nested = join(directory, SOURCE_ROOT, "examples");
  symlinkSync(join(directory, "docs"), nested);
  assert.throws(() => buildAuthoringGuide(directory), /symlink/);
}));

test("support-doc parent symlinks cannot escape the root", () => fixture((directory) => {
  rmSync(join(directory, "docs"), { recursive: true });
  symlinkSync(join(root, "docs"), join(directory, "docs"));
  assert.throws(() => buildAuthoringGuide(directory), /symlink/);
}));

test("archives, invalid UTF-8, binary contents and oversized files cannot enter the bundle", () => fixture((directory) => {
  const bad = join(directory, SOURCE_ROOT, "archive.zip");
  writeFileSync(bad, "archive");
  assert.throws(() => buildAuthoringGuide(directory), /Unsupported source/);
  rmSync(bad);
  const text = join(directory, SOURCE_ROOT, "bad.txt");
  for (const content of [Buffer.from([0xff]), "hello\0world", "x".repeat(1_000_001)]) {
    writeFileSync(text, content);
    assert.throws(() => buildAuthoringGuide(directory));
  }
}));

test("packaged output works without canonical source files and verifies its digest", () => {
  const directory = mkdtempSync(join(tmpdir(), "arcana-guide-runtime-"));
  try {
    const bundle = buildAuthoringGuide(root);
    const output = join(directory, "mcp/generated");
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "authoring-guide.txt"), bundle.text);
    writeFileSync(join(output, "authoring-guide.json"), JSON.stringify(bundle.metadata));
    assert.deepEqual(loadAuthoringGuide(directory), bundle);
    assert.deepEqual(describeAuthoringGuide(loadAuthoringGuide(directory)), describeAuthoringGuide(bundle));
    writeFileSync(join(output, "authoring-guide.txt"), bundle.text + "tampered");
    assert.throws(() => readBuiltAuthoringGuide(directory), /mismatch/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
