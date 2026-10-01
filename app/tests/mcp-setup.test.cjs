const { test, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
let createRoot;
const { BrowserSessionProvider, useBrowserSession, validatedMcpUrl } = require("../.test-build/auth/session.js");
const { McpSetup } = require("../.test-build/auth/McpSetup.js");
const { Account } = require("../.test-build/auth/Account.js");
const { act } = React;
let dom, root, container;
const original = {};
const canonicalUrl = "https://canonical.arcana.example/mcp";
const signedIn = { authenticated: true, user: { email: "reader@example.test" }, mcpUrl: canonicalUrl };

before(async () => {
  const { JSDOM } = await import("jsdom");
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://browser-alias.example/#/account/connections" });
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    original[name] = Object.getOwnPropertyDescriptor(global, name);
    Object.defineProperty(global, name, { value, writable: true, configurable: true });
  }
  original.fetch = Object.getOwnPropertyDescriptor(global, "fetch");
  ({ createRoot } = require("react-dom/client"));
  container = document.getElementById("root");
});
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
after(() => {
  dom.window.close();
  for (const [name, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(global, name, descriptor); else delete global[name];
  }
});
function fetchSession(body, status = 200) {
  global.fetch = async (url) => Response.json(url === "/auth/connections" ? { clients: [] } : body, { status });
}
async function mount(content = React.createElement(McpSetup)) {
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(BrowserSessionProvider, null, content)); });
}
function button(label) { return [...container.querySelectorAll("button")].find((node) => node.textContent === label); }
function clipboard(writeText) { Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true }); }
async function click(node) { assert.ok(node); await act(async () => node.click()); }
function SessionActions() {
  const { signOut } = useBrowserSession();
  return React.createElement(React.Fragment, null, React.createElement(McpSetup), React.createElement("button", { onClick: () => void signOut() }, "Test sign out"));
}

test("MCP URLs accept canonical HTTPS or loopback development resources, never secrets or guessed paths", () => {
  for (const value of [canonicalUrl, "https://staging.example:8443/mcp", "http://localhost:4000/mcp", "http://127.0.0.1:4000/mcp", "http://[::1]:4000/mcp"]) assert.equal(validatedMcpUrl(value), value);
  for (const value of [undefined, 17, "", "/mcp", "javascript:alert(1)", "http://public.example/mcp", "https://user:password@example/mcp", "https://example/mcp?token=secret", "https://example/mcp#token", "https://example/other", "https://example/mcp/", " https://example/mcp", "https://example/\\mcp"]) assert.equal(validatedMcpUrl(value), undefined, String(value));
});

test("setup stays hidden while loading and for anonymous, unavailable, and failed sessions", async () => {
  let resolve;
  global.fetch = () => new Promise((done) => { resolve = done; });
  await mount();
  assert.equal(container.textContent, "");
  await act(async () => resolve(Response.json({ authenticated: false })));
  assert.equal(container.textContent, "");
  for (const status of [503, 500]) {
    fetchSession({ message: "Try later", ...signedIn }, status);
    await act(async () => window.dispatchEvent(new window.Event("focus")));
    assert.equal(container.textContent, "");
  }
});

test("signed-in account shows canonical resource, setup steps, official links and a read-only check", async () => {
  fetchSession(signedIn);
  await mount();
  assert.equal(container.querySelector("input").value, canonicalUrl);
  assert.doesNotMatch(container.textContent, /browser-alias|vercel\.app/);
  assert.match(container.textContent, /Connect to Claude or ChatGPT/);
  assert.match(container.textContent, /Sign in when needed/);
  assert.match(container.textContent, /Use Claude’s published identity/);
  assert.match(container.textContent, /Developer mode/);
  assert.match(container.textContent, /workspace policy/);
  assert.match(container.textContent, /doesn’t support open dynamic client registration/);
  assert.match(container.textContent, /Never paste passwords, access tokens, or client secrets into a conversation/);
  const prompt = container.querySelector("textarea");
  assert.match(prompt.value, /get_deck_authoring_guide.*complete authoring guide.*list_my_decks/);
  assert.match(prompt.value, /Don’t create or change anything/);
  assert.equal(prompt.readOnly, true);
  for (const control of container.querySelectorAll("input, textarea")) assert.ok(container.querySelector(`label[for="${control.id}"]`));
  for (const link of container.querySelectorAll('a[target="_blank"]')) assert.equal(link.rel, "noopener noreferrer");
  assert.ok(container.querySelector('a[href="https://chatgpt.com/plugins"]'));
  assert.ok(container.querySelector('a[href="https://developers.openai.com/plugins/deploy/connect-chatgpt"]'));
  assert.equal(container.querySelectorAll("details").length, 2);
});

test("missing or malformed endpoint never falls back to the browser alias; retry can recover", async () => {
  fetchSession({ ...signedIn, mcpUrl: "https://example/mcp?token=secret" });
  await mount();
  assert.equal(container.querySelector("input"), null);
  assert.match(container.querySelector('[role="alert"]').textContent, /hasn’t supplied an MCP address/);
  assert.equal(button("Copy URL"), undefined);
  assert.doesNotMatch(container.textContent, /token=secret|browser-alias/);
  fetchSession(signedIn);
  await click(button("Check again"));
  assert.equal(container.querySelector("input").value, canonicalUrl);
});

test("copy handles repeated clicks, success, denial, manual selection and retry without network writes", async () => {
  const requests = [];
  global.fetch = async (url, init) => { requests.push([url, init.method]); return Response.json(signedIn); };
  await mount();
  let resolve, calls = [];
  clipboard((value) => { calls.push(value); return new Promise((done) => { resolve = done; }); });
  await click(button("Copy URL"));
  const pending = button("Copying…");
  assert.equal(pending.disabled, true);
  await click(pending);
  assert.deepEqual(calls, [canonicalUrl]);
  await act(async () => resolve());
  assert.match(container.textContent, /MCP server URL copied/);
  clipboard(async () => { throw new Error("Permission denied"); });
  await click(button("Copy URL"));
  assert.match(container.querySelector('[role="alert"]').textContent, /copy it manually/);
  assert.doesNotMatch(container.textContent, /MCP server URL copied/);
  const input = container.querySelector("input");
  await act(async () => input.focus());
  assert.equal(input.selectionStart, 0); assert.equal(input.selectionEnd, canonicalUrl.length);
  clipboard(async (value) => calls.push(value));
  await click(button("Copy URL"));
  await click(button("Copy prompt"));
  assert.equal(container.querySelector('[role="alert"]'), null);
  assert.equal(calls.at(-1), container.querySelector("textarea").value);
  assert.deepEqual(requests, [["/auth/session", "GET"]]);
});

test("missing clipboard support is an actionable error and logout hides all setup", async () => {
  fetchSession(signedIn);
  await mount(React.createElement(SessionActions));
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  await click(button("Copy URL"));
  assert.match(container.textContent, /copy it manually/);
  await click(button("Test sign out"));
  assert.doesNotMatch(container.textContent, /Connect to Claude|MCP server URL/);
});

test("pending clipboard completion after sign-out cannot restore the signed-in panel", async () => {
  fetchSession(signedIn);
  await mount(React.createElement(SessionActions));
  let resolve;
  clipboard(() => new Promise((done) => { resolve = done; }));
  await click(button("Copy URL"));
  await click(button("Test sign out"));
  await act(async () => resolve());
  assert.equal(container.textContent, "Test sign out");
});

test("connected clients page includes setup after sign-in even when there are no clients", async () => {
  fetchSession(signedIn);
  await mount(React.createElement(Account, { route: { page: "connections", params: new URLSearchParams() } }));
  assert.match(container.textContent, /Connect to Claude or ChatGPT/);
  assert.match(container.textContent, /No clients are connected to your account/);
  assert.equal(container.querySelector("input").value, canonicalUrl);
});
