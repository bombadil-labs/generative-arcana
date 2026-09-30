const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { Account } = require("../.test-build/auth/Account.js");
const { BrowserSessionProvider } = require("../.test-build/auth/session.js");
function render(page, query = "") {
  return renderToStaticMarkup(React.createElement(BrowserSessionProvider, null, React.createElement(Account, { route: { page, params: new URLSearchParams(query) } })));
}

test("account forms render accessible inputs, browser autofill hints and public exits", () => {
  const signup = render("signup");
  assert.match(signup, /Create your account/);
  assert.match(signup, /name="name" autoComplete="name"/);
  assert.match(signup, /type="email" autoComplete="email" required=""/);
  assert.match(signup, /type="password" autoComplete="new-password" required="" minLength="12" maxLength="128"/);
  assert.match(signup, /The bundled decks are always available without an account/);
  assert.match(render("login"), /autoComplete="current-password"/);
  assert.match(render("forgot-password"), /Send reset link/);
  assert.match(render("verify-email"), /Send verification email/);
});

test("missing and expired recovery tokens fail closed; valid token is never rendered", () => {
  const missing = render("reset-password");
  assert.match(missing, /role="alert"/);
  assert.match(missing, /reset link is missing or has expired/);
  assert.doesNotMatch(missing, /name="password"/);
  const expired = render("reset-password", "token=one-use-token&error=INVALID_TOKEN");
  assert.doesNotMatch(expired, /name="password"/);
  const valid = render("reset-password", "token=one-use-token");
  assert.match(valid, /Confirm new password/);
  assert.doesNotMatch(valid, /one-use-token/);
});

test("OAuth pages never grant access before verified context and current session", () => {
  const missing = render("consent");
  assert.match(missing, /connection request is missing/);
  assert.doesNotMatch(missing, /Allow access/);
  const loading = render("login", "oauth_query=untrusted");
  assert.match(loading, /Checking the client/);
  assert.match(loading, /type="submit" disabled=""/);
  assert.doesNotMatch(loading, /Allow access/);
  const consent = render("consent", "oauth_query=untrusted");
  assert.match(consent, /Checking the connection request/);
  assert.doesNotMatch(consent, /Allow access/);
});

test("account links sanitize external return targets and preserve encoded OAuth continuations", () => {
  const html = render("login", new URLSearchParams({ returnTo: "https://evil.test/", oauth_query: "a=1&sig=2" }).toString());
  assert.doesNotMatch(html, /evil.test/);
  assert.match(html, /returnTo=%2F%23%2Fmy-decks/);
  assert.match(html, /oauth_query=a%3D1%26sig%3D2/);
});
