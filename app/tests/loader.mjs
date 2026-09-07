import { readFile } from "node:fs/promises";
import ts from "typescript";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) specifier = new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href;
  else if (specifier.startsWith(".") && /\.ts$/.test(context.parentURL ?? "") && !/\.[cm]?[jt]sx?$/.test(specifier)) specifier += ".ts";
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (!url.endsWith(".ts")) return nextLoad(url, context);
  const source = await readFile(new URL(url), "utf8");
  return { format: "module", shortCircuit: true, source: ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    fileName: new URL(url).pathname,
  }).outputText };
}
