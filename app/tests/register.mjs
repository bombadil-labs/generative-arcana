// Use the existing TypeScript dependency with Node's test runner; no new test dependencies.
import { register } from "node:module";
register("./loader.mjs", import.meta.url);
