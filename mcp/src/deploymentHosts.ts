/** Only explicit operator/platform configuration contributes hosts, never request headers. */
export function deploymentAllowedHosts(bindHost: string, env: NodeJS.ProcessEnv = process.env): string[] {
  // Preserve the existing explicit override, including an intentionally empty deny-all list.
  if (env.MCP_ALLOWED_HOSTS !== undefined) return env.MCP_ALLOWED_HOSTS.split(',').map(value => value.trim()).filter(Boolean);
  const hosts = new Set<string>();
  if (["127.0.0.1", "localhost", "::1", "[::1]"].includes(bindHost)) {
    hosts.add("localhost"); hosts.add("127.0.0.1"); hosts.add("[::1]");
  }
  for (const value of [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_BRANCH_URL]) {
    const hostname = value?.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (hostname) hosts.add(hostname);
  }
  if (env.BETTER_AUTH_URL) {
    const origin = new URL(env.BETTER_AUTH_URL);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if ((origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback)) ||
      origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.hostname.includes('*')) {
      throw new Error('BETTER_AUTH_URL must be an exact HTTPS origin (HTTP loopback only).');
    }
    hosts.add(origin.hostname);
  }
  return [...hosts];
}
