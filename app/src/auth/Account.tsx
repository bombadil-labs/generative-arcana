import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { accountError, accountHref, accountRequest, AccountRequestError, safeAccountReturnTo, validatedOAuthRedirect, type AccountPage, type AccountRoute, type OAuthContext } from "./api";
import { useBrowserSession } from "./session";
import { McpSetup } from "./McpSetup";

interface AuthResult { redirect?: boolean; url?: string }
interface ConnectedClient { id: string; clientId: string; name: string; scopes: string[]; createdAt?: string }

/** One request per mounted form. Navigation cancels stale rendering and redirects. */
function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);
  const run = useCallback(async (action: (signal: AbortSignal) => Promise<void>) => {
    if (active.current && !active.current.signal.aborted) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    try { await action(controller.signal); }
    catch (reason) { if (!controller.signal.aborted) setError(accountError(reason)); }
    finally {
      if (!controller.signal.aborted) { setPending(false); active.current = null; }
    }
  }, []);
  return { pending, error, setError, run };
}

function useOAuthContext(oauthQuery: string | null) {
  const [context, setContext] = useState<OAuthContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setContext(null);
    setError(null);
    if (!oauthQuery) return;
    const controller = new AbortController();
    void accountRequest<OAuthContext>(`/auth/oauth/context?oauth_query=${encodeURIComponent(oauthQuery)}`, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setContext(value); })
      .catch((reason) => { if (!controller.signal.aborted) setError(accountError(reason)); });
    return () => controller.abort();
  }, [oauthQuery, attempt]);
  return { context, error, loading: !!oauthQuery && !context && !error, retry: () => setAttempt((n) => n + 1) };
}

export function Account({ route }: { route: AccountRoute }) {
  // App keys this component by route so back/forward never reuses form secrets or old requests.
  const { session } = useBrowserSession();
  const params = route.params;
  const continuation = new URLSearchParams({ returnTo: safeAccountReturnTo(params.get("returnTo")) });
  const oauthQuery = params.get("oauth_query");
  if (oauthQuery) continuation.set("oauth_query", oauthQuery);
  const props = { params, continuation, oauthQuery };
  let content: ReactNode;
  switch (route.page) {
    case "signup": content = <CredentialsForm {...props} signup />; break;
    case "login": content = <CredentialsForm {...props} signup={false} />; break;
    case "verify-email": content = <VerifyEmail {...props} />; break;
    case "forgot-password": content = <ForgotPassword {...props} />; break;
    case "reset-password": content = <ResetPassword {...props} />; break;
    case "consent": content = <Consent {...props} />; break;
    case "connections": content = <Connections key={session.status === "authenticated" ? session.user.email : session.status} />; break;
  }
  return <div className="account-page"><div className="account-card">{content}</div><p className="account-public"><a href="#/">Load your own deck</a> · <a href="#/community">Community</a><br />Browser-local JSON imports work without an account.</p></div>;
}

type PageProps = { params: URLSearchParams; continuation: URLSearchParams; oauthQuery: string | null };

function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return <header><div className="account-eyebrow">Generative Arcana · Account</div><h1>{title}</h1>{children && <p className="account-lede">{children}</p>}</header>;
}
function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`account-notice${error ? " account-error" : ""}`} role={error ? "alert" : "status"}>{children}</div>;
}
function EmailField({ value, onChange, disabled = false }: { value: string; onChange(value: string): void; disabled?: boolean }) {
  return <label className="account-field">Email<input name="email" type="email" autoComplete="email" required maxLength={254} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></label>;
}
function PasswordField({ value, onChange, newPassword = false, label = "Password", name = "password", disabled = false }: { value: string; onChange(value: string): void; newPassword?: boolean; label?: string; name?: string; disabled?: boolean }) {
  return <label className="account-field">{label}<input name={name} type="password" autoComplete={newPassword ? "new-password" : "current-password"} required minLength={newPassword ? 12 : undefined} maxLength={128} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />{newPassword && name === "password" && <small>Use 12–128 characters. A unique passphrase works well.</small>}</label>;
}
function Submit({ pending, disabled = false, children }: { pending: boolean; disabled?: boolean; children: ReactNode }) {
  return <button className="account-button" type="submit" disabled={pending || disabled}>{pending ? "Please wait…" : children}</button>;
}
function AccountLink({ page, continuation, children }: { page: AccountPage; continuation: URLSearchParams; children: ReactNode }) {
  return <a href={accountHref(page, continuation).slice(1)}>{children}</a>;
}
function absoluteCallback(page: AccountPage, continuation: URLSearchParams, extra: Record<string, string> = {}) {
  const params = new URLSearchParams(continuation);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return `${window.location.origin}${accountHref(page, params)}`;
}


function CredentialsForm({ signup, continuation, oauthQuery }: PageProps & { signup: boolean }) {
  const { refresh, session } = useBrowserSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const action = useAction();
  const oauth = useOAuthContext(oauthQuery);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void action.run(async (signal) => {
      setNeedsVerification(false);
      let result: AuthResult;
      try {
        result = await accountRequest<AuthResult>(signup ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email", {
          signal,
          body: {
            email: email.trim(), password,
            callbackURL: absoluteCallback("verify-email", continuation, { verified: "1" }),
            ...(signup ? { name: name.trim() } : {}),
            ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
          },
        });
      } catch (reason) {
        if (!signal.aborted && reason instanceof AccountRequestError && reason.code === "EMAIL_NOT_VERIFIED") setNeedsVerification(true);
        throw reason;
      }
      if (signal.aborted) return;
      setPassword("");
      if (signup) {
        // Never claim an account is usable until email verification and sign-in complete.
        const next = new URLSearchParams(continuation);
        next.set("requested", "1");
        window.location.assign(accountHref("verify-email", next));
        return;
      }
      await refresh();
      if (signal.aborted) return;
      if (oauthQuery) {
        if (!result.url || !oauth.context) throw new AccountRequestError("Signed in, but the connection could not continue. Restart it from your client.", 400);
        window.location.assign(validatedOAuthRedirect(result.url, oauth.context, window.location.origin));
      } else window.location.assign(safeAccountReturnTo(continuation.get("returnTo")));
    });
  }

  return <>
    <PageTitle title={signup ? "Create your account" : "Welcome back"}>{signup ? "Keep your decks in one place and choose how to share them." : "Sign in to your deck library."}</PageTitle>
    {oauth.loading && <Notice>Checking the client’s connection request…</Notice>}
    {oauth.error && <Notice error>{oauth.error} <button className="account-text-button" onClick={oauth.retry}>Try again</button><br />If this request has expired, restart the connection from your client.</Notice>}
    {oauth.context && <Notice>Continue connecting <strong>{oauth.context.client.name}</strong>. You’ll review its requested access before a new connection is approved.</Notice>}
    {session.status === "unavailable" && <Notice error>{session.message}</Notice>}
    {session.status === "authenticated" && !oauthQuery && <Notice>You’re signed in{session.user.email ? ` as ${session.user.email}` : ""}. <a href={safeAccountReturnTo(continuation.get("returnTo"))}>Continue to your library</a></Notice>}
    <form className="account-form" onSubmit={submit} aria-busy={action.pending}>
      {signup && <label className="account-field">Name<input name="name" autoComplete="name" required maxLength={100} value={name} disabled={action.pending} onChange={(e) => setName(e.target.value)} /></label>}
      <EmailField value={email} onChange={setEmail} disabled={action.pending} />
      <PasswordField value={password} onChange={setPassword} newPassword={signup} disabled={action.pending} />
      {action.error && <Notice error>{action.error}</Notice>}
      {needsVerification && <p><AccountLink page="verify-email" continuation={continuation}>Request another verification email</AccountLink></p>}
      <Submit pending={action.pending} disabled={session.status === "unavailable" || oauth.loading || !!oauth.error}>{signup ? "Create account" : "Sign in"}</Submit>
    </form>
    <div className="account-links">{signup ? <AccountLink page="login" continuation={continuation}>Already have an account? Sign in</AccountLink> : <><AccountLink page="forgot-password" continuation={continuation}>Forgot your password?</AccountLink><AccountLink page="signup" continuation={continuation}>Create an account</AccountLink></>}</div>
  </>;
}

function VerifyEmail({ params, continuation }: PageProps) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const action = useAction();
  const verified = params.get("verified") === "1" && !params.has("error");
  const error = params.get("error");
  function submit(event: FormEvent) {
    event.preventDefault();
    void action.run(async (signal) => {
      await accountRequest("/api/auth/send-verification-email", { signal, body: { email: email.trim(), callbackURL: absoluteCallback("verify-email", continuation, { verified: "1" }) } });
      if (!signal.aborted) setSent(true);
    });
  }
  return <>
    <PageTitle title={verified ? "Continue to your account" : "Verify your email"}>{verified ? "Your verification link has returned here. Sign in to continue." : "Open the verification link in your inbox to finish creating your account."}</PageTitle>
    {error && <Notice error>The verification link is invalid or has expired. Request a new email below.</Notice>}
    {params.get("requested") === "1" && <Notice>A verification email was requested. Check your inbox and spam folder. You’ll need to verify your address before signing in.</Notice>}
    {!verified && <form className="account-form" onSubmit={submit} aria-busy={action.pending}>
      <EmailField value={email} onChange={(value) => { setEmail(value); setSent(false); }} disabled={action.pending} />
      {sent && <Notice>If this address has an account awaiting verification, a verification email has been requested. Check your inbox.</Notice>}
      {action.error && <Notice error>{action.error}</Notice>}
      <Submit pending={action.pending}>Send verification email</Submit>
    </form>}
    <div className="account-links"><AccountLink page="login" continuation={continuation}>Continue to sign in</AccountLink></div>
  </>;
}

function ForgotPassword({ continuation }: PageProps) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const action = useAction();
  function submit(event: FormEvent) {
    event.preventDefault();
    void action.run(async (signal) => {
      await accountRequest("/api/auth/request-password-reset", { signal, body: { email: email.trim(), redirectTo: absoluteCallback("reset-password", continuation) } });
      if (!signal.aborted) setSent(true);
    });
  }
  return <>
    <PageTitle title="Reset your password">We’ll send a password reset link if this email belongs to an account.</PageTitle>
    <form className="account-form" onSubmit={submit} aria-busy={action.pending}>
      <EmailField value={email} onChange={(value) => { setEmail(value); setSent(false); }} disabled={action.pending} />
      {sent && <Notice>If an account exists for that email, a reset email has been requested. Check your inbox and spam folder.</Notice>}
      {action.error && <Notice error>{action.error}</Notice>}
      <Submit pending={action.pending}>Send reset link</Submit>
    </form>
    <div className="account-links"><AccountLink page="login" continuation={continuation}>Back to sign in</AccountLink></div>
  </>;
}

function ResetPassword({ params, continuation }: PageProps) {
  const [token] = useState(() => params.get("token") ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const action = useAction();
  const invalid = !token || params.has("error");
  useEffect(() => {
    // Do not leave the one-use recovery token in browser history or outgoing referrers.
    if (!token) return;
    const clean = new URL(window.location.href);
    clean.searchParams.delete("token");
    const hashParams = new URLSearchParams(clean.hash.split("?")[1] ?? "");
    hashParams.delete("token");
    clean.hash = `/account/reset-password${hashParams.size ? `?${hashParams.toString()}` : ""}`;
    window.history.replaceState(window.history.state, "", clean.href);
  }, [token]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) { action.setError("The passwords do not match."); return; }
    void action.run(async (signal) => {
      await accountRequest("/api/auth/reset-password", { signal, body: { token, newPassword: password } });
      if (!signal.aborted) { setPassword(""); setConfirm(""); setDone(true); }
    });
  }
  return <>
    <PageTitle title={done ? "Password updated" : "Choose a new password"}>{done ? "Sign in with your new password to continue." : "Use a unique password you haven’t used elsewhere."}</PageTitle>
    {invalid && !done && <Notice error>This reset link is missing or has expired. <AccountLink page="forgot-password" continuation={continuation}>Request a new reset link</AccountLink></Notice>}
    {!invalid && !done && <form className="account-form" onSubmit={submit} aria-busy={action.pending}>
      <PasswordField value={password} onChange={setPassword} newPassword disabled={action.pending} />
      <PasswordField value={confirm} onChange={setConfirm} newPassword name="confirmPassword" label="Confirm new password" disabled={action.pending} />
      {action.error && <Notice error>{action.error}</Notice>}
      <Submit pending={action.pending}>Update password</Submit>
    </form>}
    <div className="account-links"><AccountLink page="login" continuation={continuation}>Continue to sign in</AccountLink>{!done && <AccountLink page="forgot-password" continuation={continuation}>Request another reset link</AccountLink>}</div>
  </>;
}

const scopeDescriptions: Record<string, string> = {
  openid: "Identify your Generative Arcana account",
  profile: "Read your account’s display name and profile",
  email: "Read your email address and verification status",
  offline_access: "Stay connected until you disconnect the client or end this sign-in",
  "decks:read": "Read the decks available to your account, including private decks",
  "decks:write": "Create, update, publish, and delete decks in your account",
  "arcana:read": "Read your account’s deck library",
  "arcana:write": "Create and manage decks in your account",
};
function Scopes({ scopes }: { scopes: string[] }) {
  return <ul className="account-scopes">{scopes.map((scope) => <li key={scope}>{scopeDescriptions[scope] ?? "Access requested by the client"}<small>{scope}</small></li>)}</ul>;
}

function Consent({ continuation, oauthQuery }: PageProps) {
  const { session, refresh } = useBrowserSession();
  const oauth = useOAuthContext(oauthQuery);
  const action = useAction();
  function decide(accept: boolean) {
    if (!oauth.context || !oauthQuery) return;
    const context = oauth.context;
    void action.run(async (signal) => {
      const result = await accountRequest<AuthResult>("/api/auth/oauth2/consent", { signal, body: { accept, oauth_query: oauthQuery } });
      if (signal.aborted) return;
      if (!result.url) throw new AccountRequestError("The client response is missing. Restart the connection from your client.", 400);
      window.location.assign(validatedOAuthRedirect(result.url, context, window.location.origin));
    });
  }
  return <>
    <PageTitle title="Connect a client">Review the account and permissions before continuing.</PageTitle>
    {!oauthQuery && <Notice error>This connection request is missing. Start the connection again from your client.</Notice>}
    {oauth.loading && <Notice>Checking the connection request…</Notice>}
    {oauth.error && <Notice error>{oauth.error} <button className="account-text-button" onClick={oauth.retry}>Try again</button></Notice>}
    {session.status === "loading" && <Notice>Checking your account…</Notice>}
    {session.status === "anonymous" && <Notice><AccountLink page="login" continuation={continuation}>Sign in to review this connection</AccountLink></Notice>}
    {session.status === "unavailable" && <Notice error>{session.message}</Notice>}
    {session.status === "error" && <Notice error>{session.message} <button className="account-text-button" onClick={() => void refresh()}>Try again</button></Notice>}
    {oauth.context && <>
      <section className="account-client"><h2>{oauth.context.client.name}</h2><div className="account-code">Client ID: {oauth.context.client.clientId}</div><p>This client is requesting:</p><Scopes scopes={oauth.context.scopes} />
        {oauth.context.resource && <p className="account-code">Resource: {oauth.context.resource}</p>}
        <p className="account-code">Returns to: {oauth.context.redirectUri}</p>
      </section>
      {session.status === "authenticated" && <>
        <p>Connecting as <strong>{session.user.email || session.user.displayName || "your account"}</strong>.</p>
        <p className="account-muted">Only approve clients you trust. You can disconnect a client later from Account → Connected clients.</p>
        {action.error && <Notice error>{action.error}</Notice>}
        <div className="account-actions"><button className="account-button account-secondary" disabled={action.pending} onClick={() => decide(false)}>Deny</button><button className="account-button" disabled={action.pending} onClick={() => decide(true)}>{action.pending ? "Please wait…" : "Allow access"}</button></div>
      </>}
    </>}
    <div className="account-links"><a href="#/my-decks">Cancel and return to my decks</a></div>
  </>;
}

export function SignOutButton({ className = "account-text-button" }: { className?: string }) {
  const { signOut } = useBrowserSession();
  const action = useAction();
  return <div><button className={className} disabled={action.pending} onClick={() => void action.run(async (signal) => { await signOut(); if (!signal.aborted) window.location.assign("/#/"); })}>{action.pending ? "Signing out…" : "Sign out"}</button>{action.error && <Notice error>{action.error}</Notice>}</div>;
}

function Connections() {
  const { session, refresh } = useBrowserSession();
  const [clients, setClients] = useState<ConnectedClient[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const action = useAction();
  useEffect(() => {
    if (session.status !== "authenticated") { setClients(null); return; }
    const controller = new AbortController();
    setLoadError(null);
    setClients(null);
    void accountRequest<{ clients: ConnectedClient[] }>("/auth/connections", { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setClients(value.clients); })
      .catch((reason) => { if (!controller.signal.aborted) setLoadError(accountError(reason)); });
    return () => controller.abort();
  }, [session, attempt]);
  function disconnect(client: ConnectedClient) {
    void action.run(async (signal) => {
      await accountRequest("/auth/connections/revoke", { signal, body: { id: client.id } });
      if (signal.aborted) return;
      setClients((current) => current?.filter((item) => item.id !== client.id) ?? null);
      setConfirmId(null);
      setNotice(`${client.name} was disconnected and no longer has access to your account.`);
    });
  }
  return <>
    <PageTitle title="Connected clients">Manage the clients you’ve allowed to access Generative Arcana.</PageTitle>
    {session.status === "loading" && <Notice>Checking your account…</Notice>}
    {session.status === "anonymous" && <Notice><a href={accountHref("login", new URLSearchParams({ returnTo: "/#/account/connections" }))}>Sign in to manage connected clients</a></Notice>}
    {session.status === "unavailable" && <Notice error>{session.message}</Notice>}
    {session.status === "error" && <Notice error>{session.message} <button className="account-text-button" onClick={() => void refresh()}>Try again</button></Notice>}
    {session.status === "authenticated" && <>
      <McpSetup />
      <p className="account-muted">Signing out also ends connections authorized during this sign-in. You can reconnect after signing in again.</p>
      <div className="account-identity"><span>{session.user.displayName || session.user.email || "Your account"}{session.user.displayName && session.user.email && <small>{session.user.email}</small>}</span><SignOutButton /></div>
      {loadError && <Notice error>{loadError} <button className="account-text-button" onClick={() => setAttempt((n) => n + 1)}>Try again</button></Notice>}
      {!clients && !loadError && <Notice>Loading connected clients…</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {action.error && <Notice error>{action.error}</Notice>}
      {clients?.length === 0 && <Notice>No clients are connected to your account.</Notice>}
      {clients?.map((client) => <section className="account-client" key={client.id}><h2>{client.name}</h2><div className="account-code">Client ID: {client.clientId}</div><Scopes scopes={client.scopes} />
        {client.createdAt && !Number.isNaN(Date.parse(client.createdAt)) && <p className="account-muted">Connected {new Date(client.createdAt).toLocaleDateString()}</p>}
        {confirmId === client.id ? <><p>Disconnect {client.name}? It will immediately lose access to your account and need your permission to connect again.</p><div className="account-actions"><button className="account-button account-secondary" disabled={action.pending} onClick={() => setConfirmId(null)}>Keep connected</button><button className="account-button" disabled={action.pending} onClick={() => disconnect(client)}>{action.pending ? "Disconnecting…" : "Disconnect client"}</button></div></> : <button className="account-button account-secondary" disabled={action.pending} onClick={() => { setConfirmId(client.id); action.setError(null); setNotice(null); }}>Disconnect</button>}
      </section>)}
    </>}
    <div className="account-links"><a href="#/my-decks">Back to my decks</a></div>
  </>;
}
