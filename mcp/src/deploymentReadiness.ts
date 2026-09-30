export interface DeploymentFeatureState {
  durableCatalog: boolean;
  mcpOAuth: boolean;
  browserAuth: boolean;
  webApp: boolean;
  alphaAuth: boolean;
}

export type DependencyStatus = "not_configured" | "not_checked" | "healthy" | "unhealthy" | "timed_out" | "stale";
export interface DependencyEvidence {
  status: DependencyStatus;
  checkedAt: string | null;
}
export interface DeploymentDependencies {
  databaseConnectivity: DependencyEvidence;
  issuerDiscovery: DependencyEvidence;
}
export type DependencyProbe = (signal: AbortSignal) => Promise<unknown>;

export interface DeploymentReadiness {
  productionAccounts: boolean;
  configurationReady: boolean;
  crossHostIdentity: boolean;
  webAccountLibrary: boolean;
  checks: {
    durableCatalog: boolean;
    mcpOAuth: boolean;
    browserAuth: boolean;
    webApp: boolean;
    alphaDisabled: boolean;
    databaseConnectivity: boolean;
    issuerDiscovery: boolean;
  };
  dependencies: DeploymentDependencies;
  missing: string[];
}

/**
 * Configuration and recent connectivity evidence, separate from process liveness.
 * Database connectivity does not verify schema/permissions or persistence; issuer discovery does
 * not verify mail delivery, token issuance, JWKS rotation, or browser/host login. Those need E2E tests.
 */
export function accountDeploymentReadiness(
  state: DeploymentFeatureState,
  dependencies: DeploymentDependencies = {
    databaseConnectivity: { status: state.durableCatalog ? "not_checked" : "not_configured", checkedAt: null },
    issuerDiscovery: { status: state.mcpOAuth ? "not_checked" : "not_configured", checkedAt: null },
  },
): DeploymentReadiness {
  const configured = {
    durableCatalog: state.durableCatalog,
    mcpOAuth: state.mcpOAuth,
    browserAuth: state.browserAuth,
    webApp: state.webApp,
    alphaDisabled: !state.alphaAuth,
  };
  const checks = {
    ...configured,
    databaseConnectivity: dependencies.databaseConnectivity.status === "healthy",
    issuerDiscovery: dependencies.issuerDiscovery.status === "healthy",
  };
  const missing = Object.entries(checks)
    .filter(([, ready]) => !ready)
    .map(([name]) => name);
  const crossHostIdentity = checks.durableCatalog && checks.mcpOAuth && checks.browserAuth
    && checks.databaseConnectivity && checks.issuerDiscovery;
  const webAccountLibrary = checks.durableCatalog && checks.browserAuth && checks.webApp && checks.databaseConnectivity;
  return {
    productionAccounts: crossHostIdentity && checks.webApp && checks.alphaDisabled,
    configurationReady: Object.values(configured).every(Boolean),
    crossHostIdentity,
    webAccountLibrary,
    checks,
    dependencies,
    missing,
  };
}

/** Cached, coalesced, bounded read-only probes; liveness calls snapshot() without doing I/O. */
export function createDeploymentDependencyMonitor(
  probes: Partial<Record<keyof DeploymentDependencies, DependencyProbe>>,
  options: { timeoutMs?: number; cacheMs?: number; now?: () => number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 3_000;
  const cacheMs = options.cacheMs ?? 15_000;
  const now = options.now ?? Date.now;
  let completedAt: number | undefined;
  let inFlight: Promise<DeploymentDependencies> | undefined;
  let evidence: DeploymentDependencies = {
    databaseConnectivity: { status: probes.databaseConnectivity ? "not_checked" : "not_configured", checkedAt: null },
    issuerDiscovery: { status: probes.issuerDiscovery ? "not_checked" : "not_configured", checkedAt: null },
  };

  function snapshot(): DeploymentDependencies {
    const stale = completedAt !== undefined && now() - completedAt >= cacheMs;
    const copy = (item: DependencyEvidence): DependencyEvidence => ({
      ...item,
      status: stale && item.status === "healthy" ? "stale" : item.status,
    });
    return { databaseConnectivity: copy(evidence.databaseConnectivity), issuerDiscovery: copy(evidence.issuerDiscovery) };
  }

  async function probe(run: DependencyProbe | undefined): Promise<DependencyEvidence> {
    if (!run) return { status: "not_configured", checkedAt: null };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("Dependency probe timed out.")); }, timeoutMs);
      });
      await Promise.race([Promise.resolve().then(() => run(controller.signal)), timeout]);
      return { status: "healthy", checkedAt: new Date(now()).toISOString() };
    } catch {
      // Never expose dependency exceptions: database errors can contain credentials or user data.
      return { status: controller.signal.aborted ? "timed_out" : "unhealthy", checkedAt: new Date(now()).toISOString() };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  function check(): Promise<DeploymentDependencies> {
    if (inFlight) return inFlight;
    if (completedAt !== undefined && now() - completedAt < cacheMs) return Promise.resolve(snapshot());
    inFlight = Promise.all([probe(probes.databaseConnectivity), probe(probes.issuerDiscovery)])
      .then(([databaseConnectivity, issuerDiscovery]) => {
        evidence = { databaseConnectivity, issuerDiscovery };
        completedAt = now();
        return snapshot();
      })
      .finally(() => { inFlight = undefined; });
    return inFlight;
  }

  return { snapshot, check };
}

/** Only explicit non-secret build variables are exposed. Invalid/missing identities stay null. */
export function deploymentBuildIdentity(env: NodeJS.ProcessEnv = process.env) {
  function select(names: string[], pattern: RegExp): { value: string | null; source: string | null } {
    for (const name of names) {
      const value = env[name]?.trim();
      if (value && pattern.test(value)) return { value, source: name };
    }
    return { value: null, source: null };
  }
  const sha = select(["ARCANA_BUILD_SHA", "VERCEL_GIT_COMMIT_SHA"], /^[a-fA-F0-9]{7,64}$/);
  const id = select(["ARCANA_BUILD_ID", "VERCEL_DEPLOYMENT_ID"], /^[a-zA-Z0-9._-]{1,128}$/);
  return { sha: sha.value, shaSource: sha.source, id: id.value, idSource: id.source };
}
