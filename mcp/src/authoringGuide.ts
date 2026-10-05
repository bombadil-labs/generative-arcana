import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { describeAuthoringGuide, loadAuthoringGuide } from "../../tools/build-authoring-guide.mjs";
import type { ArcanaToolCallObserver } from "./observability";

export const AUTHORING_GUIDE_URI = "arcana://authoring/guide";
export const AUTHORING_GUIDE_TOOL = "get_deck_authoring_guide";
const bundle = loadAuthoringGuide();
const characters = Array.from(bundle.text);
const sections = describeAuthoringGuide(bundle);
const inventory = sections.map(({ text: _text, ...file }) => file);
const paths = new Set(inventory.map((file) => file.path));
const toc = [
  "GENERATIVE ARCANA — AUTHORING GUIDE TABLE OF CONTENTS",
  `Bundle format: ${bundle.metadata.formatVersion}; SHA-256: ${bundle.metadata.sha256}`,
  `Source inventory SHA-256: ${bundle.metadata.sourceDigest}`,
  `Complete guide: ${bundle.metadata.byteLength} UTF-8 bytes; ${characters.length} Unicode code points; ${inventory.length} files.`,
  "Read the full guide before design. Use files:[exact paths] in batches when constrained; start with SKILL.md and strategies/index.md, then finish all inventory files. Discuss each design decision with the user and wait for explicit agreement before proceeding to the next.",
  "Sizes below exclude filename headers; section sizes/offsets in structuredContent include headers for batching or legacy oversized-file chunks.",
  ...inventory.map((file) => `${file.path} | ${file.bytes} bytes; ${file.chars} chars | ${file.purpose}`),
].join("\n");

/** Public, host-neutral actual authoring method; no account, catalog, or renderer dependency. */
export function registerAuthoringGuide(server: McpServer, observer?: ArcanaToolCallObserver): void {
  server.registerResource("deck-authoring-guide", AUTHORING_GUIDE_URI, {
    title: "Complete Generative Arcana authoring guide",
    description: "The full canonical skill, references, strategies and supporting contracts, with source filename headers.",
    mimeType: "text/plain",
  }, async () => ({ contents: [{ uri: AUTHORING_GUIDE_URI, mimeType: "text/plain", text: bundle.text }] }));
  server.registerTool(AUTHORING_GUIDE_TOOL, {
    title: "Read the complete deck-authoring guide",
    description: "Read the full guide before designing an Arcana deck. Then discuss each design decision with the user and wait for explicit agreement before proceeding to the next. Omit arguments for the FULL canonical skill, references, strategies, schema/examples and supporting contracts verbatim with filename headers. For constrained hosts or checking an installed copy, use {toc:true} for bundle format/hash/sizes and per-file paths/purposes, then {files:[exact paths]} for WHOLE files in canonical order. Start with SKILL.md and strategies/index.md, then finish all inventory files before design or strategy selection. toc, files and legacy offset/maxChars are mutually exclusive modes. Legacy chunks retain Unicode-code-point offsets into the complete guide; use only for compatibility or an oversized file using its TOC section range. All hashes identify canonical sources/full bundle, not the TOC/subset. No sign-in required. Consult get_deck_authoring_spec before design and validate_deck_manifest after agreed content is assembled. Renderer-neutral.",
    inputSchema: z.object({
      toc: z.literal(true).optional().describe("Return the table of contents only; cannot combine with files or chunk parameters."),
      files: z.array(z.string().min(1).max(1024)).min(1).max(inventory.length).optional().describe("Exact repository-relative paths from the TOC; no duplicates. Returns whole files in canonical order."),
      offset: z.number().int().nonnegative().max(2_000_000).optional().describe("Legacy Unicode-code-point offset in the complete guide; not relative to a file."),
      maxChars: z.number().int().min(1).max(200_000).optional().describe("Legacy maximum Unicode code points; cannot combine with toc or files."),
    }).strict().refine(({ toc, files, offset, maxChars }) =>
      Number(toc !== undefined) + Number(files !== undefined) + Number(offset !== undefined || maxChars !== undefined) <= 1,
    { message: "Use only one mode: toc, files, or legacy offset/maxChars." }),
    outputSchema: z.object({
      resourceUri: z.string(), formatVersion: z.number(), sourceRoot: z.string(), sourceDigest: z.string(), sha256: z.string(), byteLength: z.number(),
      files: z.array(z.object({ path: z.string(), bytes: z.number(), sha256: z.string(), purpose: z.string(), chars: z.number(),
        section: z.object({ offset: z.number(), chars: z.number(), bytes: z.number() }) })),
      mode: z.enum(["full", "toc", "files", "chunk"]),
      selectedPaths: z.array(z.string()).optional(),
      returnedByteLength: z.number(),
      range: z.object({ offset: z.number(), returnedChars: z.number(), totalChars: z.number(), nextOffset: z.number().nullable() }).optional(),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes: [{ type: "noauth" }] },
  }, async ({ toc: tocOnly, files, offset, maxChars }) => {
    const startedAt = Date.now();
    const error = (text: string) => {
      observer?.({ tool: AUTHORING_GUIDE_TOOL, ok: false, durationMs: Date.now() - startedAt });
      return { isError: true as const, content: [{ type: "text" as const, text }] };
    };
    if (files && new Set(files).size !== files.length) return error("Duplicate file paths are not allowed. Use exact paths from {toc:true} once each.");
    if (files?.some((path) => !paths.has(path))) return error("Unknown file path. Use exact repository-relative paths from {toc:true}; aliases, URLs and traversal are not supported.");
    const start = offset ?? 0;
    if (start > characters.length) return error("offset exceeds the complete guide's character count.");
    const end = Math.min(characters.length, start + (maxChars ?? characters.length));
    const selected = files ? sections.filter((file) => files.includes(file.path)) : undefined;
    const text = tocOnly ? toc : selected ? selected.map((file) => file.text).join("\n") : characters.slice(start, end).join("");
    const mode = tocOnly ? "toc" as const : selected ? "files" as const : offset !== undefined || maxChars !== undefined ? "chunk" as const : "full" as const;
    observer?.({ tool: AUTHORING_GUIDE_TOOL, ok: true, durationMs: Date.now() - startedAt });
    return {
      content: [{ type: "text", text }],
      structuredContent: { resourceUri: AUTHORING_GUIDE_URI, ...bundle.metadata, files: inventory, mode, returnedByteLength: Buffer.byteLength(text),
        ...(selected ? { selectedPaths: selected.map((file) => file.path) } : {}),
        ...(!tocOnly && !selected ? { range: { offset: start, returnedChars: end - start, totalChars: characters.length, nextOffset: end < characters.length ? end : null } } : {}) },
    };
  });
}
