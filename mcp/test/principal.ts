import assert from "node:assert/strict";
import deepTime from "../../decks/deep-time/deck.json";
import { createBundledArcanaAdapter, InMemoryArcanaHostStore } from "../src/hostStore";
import { resolveArcanaRequestAccess, type PrincipalResolver, type PrincipalRequest } from "../src/principal";

const request: PrincipalRequest = {
  method: "POST",
  url: "/mcp",
  headers: new Headers({ authorization: "Bearer opaque" }),
};

async function main(): Promise<void> {
  const anonymous = createBundledArcanaAdapter();
  const hosts = new InMemoryArcanaHostStore();

  const anonymousAccess = await resolveArcanaRequestAccess(request, anonymous, hosts);
  assert.strictEqual(anonymousAccess.adapter, anonymous);
  assert.equal(anonymousAccess.includeStatefulTools, false);
  assert.equal(anonymousAccess.principal, null);
  assert.equal(hosts.size, 0);

  const resolver: PrincipalResolver = {
    resolve(input) {
      assert.equal(input.headers.get("authorization"), "Bearer opaque");
      return { id: "user-123" };
    },
  };

  const first = await resolveArcanaRequestAccess(request, anonymous, hosts, resolver);
  const second = await resolveArcanaRequestAccess(request, anonymous, hosts, resolver);
  assert.equal(first.principal?.id, "user-123");
  assert.equal(first.includeStatefulTools, true);
  assert.strictEqual(second.adapter, first.adapter, "same resolved principal must reuse host state");

  const custom = structuredClone(deepTime);
  custom.slug = "principal-custom";
  custom.name = "Principal Custom";
  await first.adapter.call("import_deck", { data: custom });
  const decks = await second.adapter.call("list_decks") as Array<{ id: string }>;
  assert.equal(decks.some((deck) => deck.id === custom.slug), true);

  await assert.rejects(
    resolveArcanaRequestAccess(request, anonymous, hosts, { resolve: () => ({ id: "   " }) }),
    /non-empty string/,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
