export interface DeploymentFeatureState {
  durableCatalog: boolean;
  mcpOAuth: boolean;
  browserAuth: boolean;
  webApp: boolean;
  alphaAuth: boolean;
}

export interface DeploymentReadiness {
  productionAccounts: boolean;
  crossHostIdentity: boolean;
  webAccountLibrary: boolean;
  checks: {
    durableCatalog: boolean;
    mcpOAuth: boolean;
    browserAuth: boolean;
    webApp: boolean;
    alphaDisabled: boolean;
  };
  missing: string[];
}

/**
 * Non-secret deployment diagnostics for the account-enabled product surface.
 *
 * The service can be healthy and useful anonymously while production account readiness is false.
 * This therefore stays separate from process liveness and reports only feature/configuration state.
 */
export function accountDeploymentReadiness(state: DeploymentFeatureState): DeploymentReadiness {
  const checks = {
    durableCatalog: state.durableCatalog,
    mcpOAuth: state.mcpOAuth,
    browserAuth: state.browserAuth,
    webApp: state.webApp,
    alphaDisabled: !state.alphaAuth,
  };
  const missing = Object.entries(checks)
    .filter(([, ready]) => !ready)
    .map(([name]) => name);
  const crossHostIdentity = checks.durableCatalog && checks.mcpOAuth && checks.browserAuth;
  const webAccountLibrary = checks.durableCatalog && checks.browserAuth && checks.webApp;
  return {
    productionAccounts: crossHostIdentity && checks.webApp && checks.alphaDisabled,
    crossHostIdentity,
    webAccountLibrary,
    checks,
    missing,
  };
}
