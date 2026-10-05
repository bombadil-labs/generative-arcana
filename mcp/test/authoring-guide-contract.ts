import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Client } from "@modelcontextprotocol/client";
import { describeAuthoringGuide, loadAuthoringGuide } from "../../tools/build-authoring-guide.mjs";
import { AUTHORING_GUIDE_TOOL, AUTHORING_GUIDE_URI } from "../src/authoringGuide";

export async function assertAuthoringGuide(client: Client, chunks = false): Promise<void> {
  const expected = loadAuthoringGuide();
  const sections = describeAuthoringGuide(expected);
  const inventory = sections.map(({ text: _text, ...file }) => file);
  const tools = await client.listTools();
  const tool = tools.tools.find((item) => item.name === AUTHORING_GUIDE_TOOL);
  assert.ok(tool, "full authoring method must be discoverable as a tool");
  assert.match(tool.description ?? "", /Read the full guide before designing/);
  assert.match(tool.description ?? "", /finish all inventory files before design or strategy selection/);
  assert.match(tool.description ?? "", /discuss each design decision with the user and wait for explicit agreement before proceeding to the next/);
  assert.equal(tool.annotations?.readOnlyHint, true);
  assert.equal(tool.annotations?.destructiveHint, false);
  assert.deepEqual(tool._meta?.securitySchemes, [{ type: "noauth" }]);
  const resources = await client.listResources();
  assert.ok(resources.resources.some((resource) => resource.uri === AUTHORING_GUIDE_URI));
  const resource = await client.readResource({ uri: AUTHORING_GUIDE_URI });
  assert.equal(resource.contents[0].mimeType, "text/plain");
  assert.equal("text" in resource.contents[0] && resource.contents[0].text, expected.text);
  const result = await client.callTool({ name: AUTHORING_GUIDE_TOOL, arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(result.content.length, 1, "full source must not be duplicated as extra text blocks");
  assert.equal(result.content[0].type === "text" && result.content[0].text, expected.text);
  const metadata = result.structuredContent as Record<string, unknown>;
  assert.equal(metadata.sha256, createHash("sha256").update(expected.text).digest("hex"));
  assert.deepEqual(metadata.files, inventory);
  assert.equal(metadata.sourceDigest, createHash("sha256").update(JSON.stringify(inventory.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })))).digest("hex"));
  assert.equal(metadata.mode, "full");
  assert.equal(metadata.returnedByteLength, expected.metadata.byteLength);
  const noArguments = await client.callTool({ name: AUTHORING_GUIDE_TOOL });
  assert.deepEqual(noArguments, result, "omitted arguments and an empty object both return the complete guide");
  const toc = await client.callTool({ name: AUTHORING_GUIDE_TOOL, arguments: { toc: true } });
  assert.equal(toc.isError, undefined);
  const tocText = toc.content[0].type === "text" ? toc.content[0].text : "";
  assert.match(tocText, /then finish all inventory files/);
  assert.match(tocText, /wait for explicit agreement before proceeding to the next/);
  const tocMetadata = toc.structuredContent as Record<string, unknown>;
  assert.equal(tocMetadata.mode, "toc");
  assert.equal(tocMetadata.range, undefined);
  assert.equal(tocMetadata.selectedPaths, undefined);
  assert.ok(Buffer.byteLength(tocText) < expected.metadata.byteLength / 10, "TOC must be a cheap discovery/hash check");
  assert.ok(!tocText.includes("===== BEGIN FILE:"));
  for (const file of inventory) {
    assert.ok(tocText.includes(file.path) && tocText.includes(file.purpose));
  }
  const selection = [sections.at(-1)!, sections[0], sections[8]];
  const selected = await client.callTool({ name: AUTHORING_GUIDE_TOOL, arguments: { files: selection.map(({ path }) => path) } });
  assert.equal(selected.isError, undefined);
  const selectedText = selected.content[0].type === "text" ? selected.content[0].text : "";
  const selectedMetadata = selected.structuredContent as Record<string, unknown>;
  const ordered = [sections[0], sections[8], sections.at(-1)!];
  assert.equal(selectedText, ordered.map(({ text }) => text).join("\n"), "selection order is canonical, with whole verbatim files");
  assert.equal(selectedMetadata.mode, "files");
  assert.deepEqual(selectedMetadata.selectedPaths, ordered.map(({ path }) => path));
  assert.equal(selectedMetadata.range, undefined);
  assert.equal(selectedMetadata.returnedByteLength, ordered.reduce((size, file) => size + file.section.bytes, 0) + ordered.length - 1);
  for (const actual of [tocMetadata, selectedMetadata]) {
    for (const key of ["resourceUri", "formatVersion", "sourceRoot", "sourceDigest", "sha256", "byteLength", "files"]) assert.deepEqual(actual[key], metadata[key]);
  }
  const spec = await client.callTool({ name: "get_deck_authoring_spec", arguments: {} });
  const specResult = (spec.structuredContent as Record<string, unknown>).result as { authoringGuide: { mcpTool: string; resourceUri: string; description: string } };
  assert.equal(specResult.authoringGuide.mcpTool, AUTHORING_GUIDE_TOOL);
  assert.equal(specResult.authoringGuide.resourceUri, AUTHORING_GUIDE_URI);
  assert.match(specResult.authoringGuide.description, /wait for explicit agreement before proceeding to the next/);

  if (chunks) {
    for (const file of sections) {
      const one = await client.callTool({ name: AUTHORING_GUIDE_TOOL, arguments: { files: [file.path] } });
      assert.equal(one.content[0].type === "text" && one.content[0].text, file.text);
      const fallback = await client.callTool({ name: AUTHORING_GUIDE_TOOL, arguments: { offset: file.section.offset, maxChars: file.section.chars } });
      assert.equal(fallback.content[0].type === "text" && fallback.content[0].text, file.text);
    }
    const all = await client.callTool({ name: AUTHORING_GUIDE_TOOL, arguments: { files: sections.map(({ path }) => path).reverse() } });
    assert.equal(all.content[0].type === "text" && all.content[0].text, sections.map(({ text }) => text).join("\n"));
    const path = sections[0].path;
    for (const args of [
      { toc: true, files: [path] }, { toc: true, offset: 0 }, { toc: true, maxChars: 1 },
      { files: [path], offset: 0 }, { files: [path], maxChars: 1 }, { toc: true, files: [path], offset: 0, maxChars: 1 },
      { files: [] }, { files: [path, path] }, { files: ["SKILL.md"] }, { files: [path, "unknown.md"] },
      { files: ["../README.md"] }, { files: ["/etc/passwd"] }, { files: ["skill/generative-arcana/../SKILL.md"] },
      { files: ["skill\\generative-arcana\\SKILL.md"] }, { files: ["file:///etc/passwd"] }, { files: ["docs//schema-v2.md"] },
      { files: ["docs/./schema-v2.md"] }, { files: ["docs/schema-v2.md\n"] }, { files: [""] },
      { files: [null] }, { files: path }, { files: null }, { files: [path.repeat(100)] },
      { toc: false }, { toc: "true" }, { toc: null }, { unexpected: true },
      { offset: -1 }, { offset: 0.5 }, { maxChars: 0 }, { maxChars: 200_001 },
    ]) {
      const invalid = await client.callTool({ name: AUTHORING_GUIDE_TOOL, arguments: args });
      assert.equal(invalid.isError, true, `invalid input must fail without partial content: ${JSON.stringify(args)}`);
      assert.equal(invalid.structuredContent, undefined);
    }
    let offset: number | null = 0;
    let complete = "";
    while (offset !== null) {
      const chunk = await client.callTool({ name: AUTHORING_GUIDE_TOOL, arguments: { offset, maxChars: 4093 } });
      assert.equal(chunk.isError, undefined);
      assert.equal(chunk.content[0].type, "text");
      const text = chunk.content[0].type === "text" ? chunk.content[0].text : "";
      const range = (chunk.structuredContent as Record<string, unknown>).range as { offset: number; returnedChars: number; totalChars: number; nextOffset: number | null };
      assert.equal(range.offset, offset);
      assert.equal(range.returnedChars, Array.from(text).length);
      complete += text;
      offset = range.nextOffset;
    }
    assert.equal(complete, expected.text, "chunk concatenation must reproduce the canonical full artifact losslessly");
    const finalOffset = Array.from(expected.text).length;
    const empty = await client.callTool({ name: AUTHORING_GUIDE_TOOL, arguments: { offset: finalOffset } });
    assert.equal(empty.isError, undefined);
    assert.equal(empty.content[0].type === "text" && empty.content[0].text, "");
    assert.deepEqual((empty.structuredContent as Record<string, unknown>).range, { offset: finalOffset, returnedChars: 0, totalChars: finalOffset, nextOffset: null });
    const invalid = await client.callTool({ name: AUTHORING_GUIDE_TOOL, arguments: { offset: 2_000_000 } });
    assert.equal(invalid.isError, true);
  }
}
