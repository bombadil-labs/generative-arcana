import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { publicDistribution } from "./build/publicDistribution";

// The Generative Arcana deck app. Static SPA, GitHub-Pages-ready:
//  - base "./" so it works under any /<repo-name>/ path without hardcoding it
//  - hash routing (see src/app/router.ts) so no server rewrites / 404 fallback are needed
//  - "@"     -> this app's source (src/)
export default defineConfig({
  base: "./",
  plugins: [publicDistribution(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Only the app is a development web root; historical repository files are not public.
  server: { open: false, fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] } },
});
