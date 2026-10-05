import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portableDir = resolve(root, "skill/generative-arcana");
const portablePath = resolve(portableDir, "SKILL.md");
const claudePath = resolve(root, ".claude/skills/generative-arcana/SKILL.md");

const portable = readFileSync(portablePath, "utf8");
const claude = readFileSync(claudePath, "utf8");
const portableMeta = frontmatter(portable, portablePath);
const claudeMeta = frontmatter(claude, claudePath);

assert(portableMeta.name === "generative-arcana", "portable skill name must be generative-arcana");
assert(claudeMeta.name === portableMeta.name, "Claude wrapper and portable bundle must expose the same skill name");
assert(/^[a-z0-9-]{1,64}$/.test(portableMeta.name), "skill name must satisfy portable Agent Skill naming constraints");
assert(!/(?:^|-)(?:anthropic|claude)(?:-|$)/.test(portableMeta.name), "portable skill name must not contain reserved host names");
for (const [label, meta] of [["portable", portableMeta], ["Claude", claudeMeta]]) {
  assert(meta.description.length > 0 && meta.description.length <= 1024, `${label} skill description must be 1..1024 characters`);
}

assert(portable.includes("get_deck_authoring_spec"), "portable workflow must consult the platform authoring spec when available");
assert(portable.includes("validate_deck_manifest"), "portable workflow must validate canonical manifests when the platform tool is available");
assert(portable.includes("valid: true, canonical: true"), "portable workflow must require canonical validation success before connected delivery/import");
assert(portable.includes("references/visual_language.md"), "portable workflow must reference the structured visual-language contract");
assert(portable.includes("## Read the full skill before the design dialogue"), "read the full skill before any design dialogue");
assert(portable.includes("finish reading **all** inventory files before beginning the design dialogue"), "batch retrieval must complete before design");
assert(portable.includes("wait for explicit agreement before proceeding to the next decision or generating dependent content"), "every design decision needs agreement before dependent work");
assert((portable.match(/\*\*Agreement gates:\*\*/g) ?? []).length === 5, "suits, transversal, majors, ranks and projection must retain agreement gates");
assert(!/Don't prompt stage-by-stage|plan once, adjust once, build|let the user adjust in one pass|Creative judgment supersedes the plan/.test(portable), "one-pass or unilateral-plan instructions contradict the dialogue");
const strategies = readFileSync(resolve(portableDir, "strategies/index.md"), "utf8");
assert(strategies.includes("waiting for explicit agreement before dependent work"), "all strategy feedback checkpoints must be agreement gates");
const visualLanguage = readFileSync(resolve(portableDir, "references/visual_language.md"), "utf8");
for (const phrase of ["Rank recognizability", "Factorization composition", "Style inversion", "Subject-removal", "Station leakage", "Cross-deck distinctiveness"]) {
  assert(visualLanguage.includes(phrase), `visual-language quality contract must retain stress test: ${phrase}`);
}

const canonicalRelative = "../../../skill/generative-arcana/SKILL.md";
assert(claude.includes(canonicalRelative), "Claude wrapper must delegate to the portable authoring bundle");
assert(claude.length < 2500, "Claude wrapper should remain discovery glue rather than duplicating the authoring workflow");
assert(!claude.includes("interface DeckManifest"), "Claude wrapper must not define a competing deck schema");
assert(!claude.includes("Stage 1"), "Claude wrapper must not copy the authoring stages");

const referencedMarkdown = new Set(
  [...portable.matchAll(/`((?:references|strategies)\/[A-Za-z0-9_./-]+\.md)`/g)].map((match) => match[1]),
);
assert(referencedMarkdown.size > 0, "portable workflow should name its supporting authoring modules");
for (const relative of referencedMarkdown) {
  assert(existsSync(resolve(portableDir, relative)), `portable workflow references missing file: ${relative}`);
}

console.log(`authoring host contract OK: ${referencedMarkdown.size} referenced modules, thin Claude wrapper, one portable workflow`);

function frontmatter(text, path) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert(match, `${path} must start with YAML frontmatter`);
  const values = {};
  for (const line of match[1].split("\n")) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key === "name" || key === "description") values[key] = value;
  }
  assert(typeof values.name === "string" && values.name, `${path} must declare name`);
  assert(typeof values.description === "string" && values.description, `${path} must declare description`);
  return values;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
