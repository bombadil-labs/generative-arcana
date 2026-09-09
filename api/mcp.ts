import { createMcpHandler } from "@modelcontextprotocol/server";
import { StaticBearerPrincipalResolver } from "../mcp/src/alphaAuth.js";
import { createBundledArcanaAdapter } from "../mcp/src/hostStore.js";
import { NeonArcanaHostStateRepository } from "../mcp/src/neonHostStateRepository.js";
import { PersistingArcanaToolAdapter, restoreArcanaHostState } from "../mcp/src/hostState.js";
import { jsonToolCallObserver } from "../mcp/src/observability.js";
import { createArcanaMcpServer } from "../mcp/src/server.js";

const alphaToken = optionalEnv(process.env.MCP_ALPHA_TOKEN);
const alphaPrincipalId = optionalEnv(process.env.MCP_ALPHA_PRINCIPAL_ID) ?? "alpha-user-v1";
const databaseUrl = optionalEnv(process.env.DATABASE_URL);
const resolver = alphaToken ? new StaticBearerPrincipalResolver(alphaToken, alphaPrincipalId) : undefined;
const repository = databaseUrl ? new NeonArcanaHostStateRepository(databaseUrl) : undefined;

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const principal = resolver ? await resolver.resolve({ method: request.method, url: request.url, headers: request.headers }) : null;

      if (!principal) {
        const adapter = createBundledArcanaAdapter();
        const handler = createMcpHandler(() => createArcanaMcpServer({
          adapter,
          includeStatefulTools: false,
          onToolCall: jsonToolCallObserver({ transport: "http", principalId: null }),
        }));
        return handler.fetch(request);
      }

      if (!repository) {
        return Response.json({ error: "authenticated_state_unavailable" }, { status: 503 });
      }

      const adapter = createBundledArcanaAdapter();
      const rawState = await repository.load(principal.id);
      if (rawState !== null) restoreArcanaHostState(adapter, rawState);
      const persistentAdapter = new PersistingArcanaToolAdapter(adapter, principal.id, repository);
      const handler = createMcpHandler(() => createArcanaMcpServer({
        adapter: persistentAdapter,
        includeStatefulTools: true,
        onToolCall: jsonToolCallObserver({ transport: "http", principalId: principal.id }),
      }));
      return handler.fetch(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unauthorized";
      return Response.json({ error: "principal_resolution_failed", message }, { status: 401 });
    }
  },
};

function optionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
