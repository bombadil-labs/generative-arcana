import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Client } from "@modelcontextprotocol/client";
import { loadAuthoringGuide } from "../../tools/build-authoring-guide.mjs";
import { AUTHORING_GUIDE_TOOL, AUTHORING_GUIDE_URI } from "../src/authoringGuide";

export async function assertAuthoringGuide(client: Client, chunks = false): Promise<void> {
  const expected = loadAuthoringGuide();
  const tools = await client.listTools();
  const tool = tools.tools.find((item) => item.name === AUTHORING_GUIDE_TOOL);
  assert.ok(tool, "full authoring method must be discoverable as a tool");
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
  assert.deepEqual(metadata.files, expected.metadata.files);
  const spec = await client.callTool({ name: "get_deck_authoring_spec", arguments: {} });
  const specResult = (spec.structuredContent as Record<string, unknown>).result as { authoringGuide: { mcpTool: string; resourceUri: string } };
  assert.equal(specResult.authoringGuide.mcpTool, AUTHORING_GUIDE_TOOL);
  assert.equal(specResult.authoringGuide.resourceUri, AUTHORING_GUIDE_URI);

  if (chunks) {
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
    const invalid = await client.callTool({ name: AUTHORING_GUIDE_TOOL, arguments: { offset: 2_000_000 } });
    assert.equal(invalid.isError, true);
  }
}
