import { ARCANA_MCP_VERSION } from "../mcp/src/version.js";

export default {
  async fetch(): Promise<Response> {
    return Response.json({
      ok: true,
      service: "generative-arcana-mcp",
      version: ARCANA_MCP_VERSION,
      runtime: "vercel-functions",
      auth: process.env.MCP_ALPHA_TOKEN ? "alpha-bearer" : "anonymous",
      state: process.env.DATABASE_URL ? "neon" : "stateless",
    });
  },
};
