/**
 * Ultima's typed card definitions are pure modules. This index owns the batch explicitly and binds
 * every definition to the `ultima/animated` visual pack in one place.
 */
import { registerKitPack } from "@/runtime/defineCard";
import type { CardSketch } from "@/runtime/types";

const modules = import.meta.glob(["./*.ts", "!./index.ts"], {
  eager: true,
  import: "default",
}) as Record<string, CardSketch>;

registerKitPack("ultima", "animated", Object.values(modules));
