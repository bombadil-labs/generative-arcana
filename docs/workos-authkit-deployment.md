# WorkOS AuthKit deployment adapter

Generative Arcana's authentication boundary is intentionally provider-neutral. The MCP server is an OAuth resource server; the authorization server is deployment configuration. As of September 2026, WorkOS AuthKit is the recommended production adapter because its Connect/MCP surface tracks the current MCP authorization specification closely while also providing a first-party React authentication path for the future web app.

Nothing in the deck domain, catalog, or reading engine depends on WorkOS. Replacing the provider later means changing deployment/auth adapters, not migrating deck ownership.

## Why AuthKit for the first production deployment

AuthKit currently provides the pieces Generative Arcana needs in one authorization server:

- OAuth authorization-code flow with PKCE/S256;
- OAuth/OIDC discovery metadata and JWKS;
- MCP Resource Indicators, which mint access tokens whose `aud` matches the MCP resource URL;
- Client ID Metadata Documents (CIMD), the current preferred MCP client-identification mechanism;
- Dynamic Client Registration (DCR) as a compatibility fallback for clients that do not yet implement CIMD;
- hosted user login/consent plus a React SDK for the first-party web app;
- stable WorkOS user ids in `sub`, so multiple host adapters can resolve onto Generative Arcana's opaque internal principal ids.

The MCP service continues to validate tokens itself with `jose`; it does not import a WorkOS SDK.

## Production topology

Use one WorkOS environment for the Generative Arcana user population.

```text
ChatGPT ─┐
Claude  ─┼─ OAuth/PKCE ─→ AuthKit / WorkOS Connect ─→ access token
other MCP┘                                      │
                                               ↓
                                    Generative Arcana MCP
                                    (OAuth resource server)
                                               │
                                               ↓
                                    issuer+sub → usr_* → decks

Web app ───────────────→ AuthKit user session ─→ web/API adapter
                                                   │
                                                   └→ same usr_* identity layer
```

The web app's access token may have a different audience from the MCP token. Verify each token for its own resource, then resolve the authenticated external identity through the same internal identity repository. Never use email, display name, or a host-specific account id as a deck owner key.

## WorkOS dashboard configuration

### 1. Create the production AuthKit environment

Create a production environment and configure the login methods you want to support. A custom authentication domain is recommended before public launch so the issuer/login surface is owned by the Generative Arcana product domain rather than a temporary vendor hostname.

Record the exact issuer shown by WorkOS discovery metadata. Issuer comparison is deliberately byte-for-byte; do not casually add or remove a trailing slash in environment variables.

### 2. Configure WorkOS Connect for MCP

Under **Connect → Configuration**:

1. Enable **Client ID Metadata Document (CIMD)**.
2. Enable **Dynamic Client Registration (DCR)** as a backwards-compatibility fallback while MCP clients converge on CIMD.
3. Add the exact production MCP endpoint as a **Resource Indicator**, for example `https://YOUR_DOMAIN/mcp`.
4. Make that Resource Indicator the default. Modern clients send `resource`; this also gives older clients that omit it an access token with the correct audience.
5. Make the Generative Arcana authorization scopes available to dynamically identified/registered clients:
   - `decks:read`
   - `decks:write`
6. Keep the normal OIDC identity scopes (`openid`, `email`, `profile`) available where appropriate. They are useful for login/userinfo and workspace-domain protections, but the MCP resource server does not store them as deck ownership data.

Consent should remain enabled for third-party MCP clients.

### 3. Production MCP environment variables

Configure the deployed MCP container with:

```text
DATABASE_URL=<Neon production connection string>

MCP_OAUTH_ISSUER=https://YOUR_AUTHKIT_DOMAIN
MCP_OAUTH_RESOURCE=https://YOUR_MCP_DOMAIN/mcp
MCP_OAUTH_JWKS_URI=https://YOUR_AUTHKIT_DOMAIN/oauth2/jwks
MCP_OAUTH_READ_SCOPES=decks:read
MCP_OAUTH_WRITE_SCOPES=decks:write
```

`MCP_OAUTH_JWKS_URI` is optional because the server can discover it from OIDC metadata, but setting it explicitly removes one discovery hop from token verification.

Remove `MCP_ALPHA_TOKEN` from the production deployment when OAuth is enabled. The server intentionally refuses to start with both auth modes configured.

Keep the existing host/origin restrictions configured for the production hostname.

## Discovery endpoints

With OAuth enabled, the MCP server exposes:

```text
GET /.well-known/oauth-protected-resource/mcp
GET /.well-known/oauth-protected-resource
```

Both point clients to the configured upstream AuthKit issuer.

For backwards compatibility, Generative Arcana also exposes:

```text
GET /.well-known/oauth-authorization-server
```

This does **not** make Generative Arcana an authorization server. The endpoint fetches the configured issuer's RFC 8414 metadata, validates that its `issuer` exactly matches `MCP_OAUTH_ISSUER`, and returns that document. It exists for older MCP clients that still try authorization-server discovery on the resource-server origin instead of following RFC 9728 protected-resource metadata.

The issuer is server configuration rather than request input, so the route is not an open metadata proxy.

## Client behavior

### ChatGPT / Codex

Prefer CIMD when the connection surface offers it. The authorization server must advertise S256 PKCE support and accept the `resource` parameter. The MCP resource URL in WorkOS must exactly match `MCP_OAUTH_RESOURCE`, because Generative Arcana validates it as the JWT audience.

DCR can remain enabled during the transition for OpenAI connections configured to use it and for other clients that have not adopted CIMD.

### Claude

Claude custom connectors use delegated per-user OAuth when the remote MCP server requires it. The same production MCP URL and AuthKit authorization server should be used; there is no Claude-specific identity or deck namespace.

Claude also permits manually supplied OAuth client credentials in custom-connector advanced settings. That remains a useful compatibility path if a particular Claude surface cannot dynamically identify/register itself against the current authorization server.

### Generic MCP clients

Modern clients should follow RFC 9728 protected-resource metadata, pass the resource indicator, use PKCE, and identify themselves through CIMD. DCR and the local authorization-metadata proxy are compatibility paths, not separate account systems.

## First-party web app

Use the same AuthKit environment when the web app gains sign-in. The current Vite/React application can use the AuthKit React SDK for the browser login/session UX, while a web/API auth adapter verifies the web token and resolves it through the same internal account layer used by MCP.

Keep these boundaries explicit:

- AuthKit user/profile data is presentation/account data, not deck identity.
- The canonical deck owner remains the opaque Generative Arcana `usr_*` id.
- The MCP and web APIs may validate tokens with different audiences but should converge on the same external user identity before resolving `usr_*`.
- Do not make the browser SDK or a WorkOS type part of `UserDeckRecord`, `ArcanaEngine`, or the deck manifest schema.

## Verification checklist

Before switching production away from the alpha token:

1. Fetch the AuthKit OAuth/OIDC metadata and verify the exact issuer, PKCE/S256, client-registration capabilities, token endpoint, UserInfo endpoint, and JWKS.
2. Fetch Generative Arcana protected-resource metadata and verify the `resource` and `authorization_servers` values.
3. Fetch the compatibility authorization-server endpoint and verify it returns the same upstream issuer metadata.
4. Connect from ChatGPT and complete a fresh OAuth consent flow.
5. Connect the same account from Claude and verify it resolves the same private deck catalog.
6. Import a deck from one host and verify the other host sees it after authentication.
7. Verify an anonymous client cannot enumerate private/unlisted user decks.
8. Revoke/disconnect a client and verify expired/revoked credentials cannot mutate the catalog.

## Portability rule

WorkOS is the recommended first deployment adapter, not a platform invariant. A replacement authorization server is valid if it can satisfy the MCP OAuth contract and produce a stable external subject that Generative Arcana can map onto an internal principal. The rest of the platform should not know which provider did the login.
