import type { IncomingMessage, ServerResponse } from "node:http";
import type { ExternalIdentity, ExternalIdentityRepository } from "./oauthIdentity.js";
import type { ArcanaPrincipal } from "./principal.js";

export interface BrowserSessionUser {
  identity: ExternalIdentity;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface BrowserSessionAuthenticator {
  authenticate(req: IncomingMessage, res: ServerResponse): Promise<BrowserSessionUser | null>;
}

export interface BrowserPrincipalResolver {
  resolve(req: IncomingMessage, res: ServerResponse): Promise<ArcanaPrincipal | null>;
}

/**
 * Provider-neutral bridge from a browser session into Generative Arcana identity.
 *
 * Session providers prove an external `(issuer, subject)` identity. The identity repository alone
 * owns translation into the stable opaque `usr_*` principal used by deck ownership.
 */
export class ExternalIdentityBrowserPrincipalResolver implements BrowserPrincipalResolver {
  constructor(
    private readonly authenticator: BrowserSessionAuthenticator,
    private readonly identities: ExternalIdentityRepository,
  ) {}

  async resolve(req: IncomingMessage, res: ServerResponse): Promise<ArcanaPrincipal | null> {
    const session = await this.authenticator.authenticate(req, res);
    if (!session) return null;
    const id = await this.identities.resolveOrCreate(session.identity);
    return { id };
  }
}
