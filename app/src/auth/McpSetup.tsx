import { useEffect, useId, useRef, useState } from "react";
import { useBrowserSession } from "./session";

const CONNECTION_CHECK = "Use Arcana’s get_deck_authoring_guide to read the complete authoring guide, then call list_my_decks to confirm my account connection. Don’t create or change anything.";

/** Available after the server has confirmed an authenticated browser session. */
export function McpSetup() {
  const { session, refresh } = useBrowserSession();
  const titleId = useId();
  if (session.status !== "authenticated") return null;

  return <section className="mcp-setup" aria-labelledby={titleId}>
    <header>
      <div className="account-eyebrow">Bring your library into a conversation</div>
      <h2 id={titleId}>Connect to Claude or ChatGPT</h2>
      <p>Use Arcana’s MCP connection to design decks and work with your library in your AI assistant. Add it once, then approve access to this same Arcana account.</p>
    </header>
    {session.mcpUrl
      ? <CopyValue key={session.mcpUrl} label="MCP server URL" value={session.mcpUrl} button="Copy URL" />
      : <div className="account-notice account-error" role="alert">The account service hasn’t supplied an MCP address. <button className="account-text-button" onClick={() => void refresh()}>Check again</button> If it’s still missing, contact the Arcana operator. Don’t guess a server address.</div>}
    <div className="mcp-setup-guides">
      <details>
        <summary>Set up Claude</summary>
        <div className="mcp-setup-steps">
          <ol>
            <li>On Claude web or desktop, open <strong>Customize → Connectors → + Add → Add custom connector</strong>.</li>
            <li>Name it <strong>Generative Arcana</strong> and paste the MCP server URL above.</li>
            <li>For Authentication, choose <strong>Sign in when needed</strong>. For OAuth client, choose <strong>Use Claude’s published identity</strong>, then add the connector.</li>
            <li>Enable Arcana from the chat’s <strong>+ → Connectors</strong> menu. Ask for your deck library, then follow the Arcana sign-in prompt and review the permissions before approving.</li>
          </ol>
          <p>Custom connectors depend on your Claude plan and organization settings. A Team or Enterprise owner may need to add or allow the connector first. If the controls aren’t available, check with your workspace owner.</p>
          <a href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp" target="_blank" rel="noopener noreferrer">Claude’s current setup guide ↗</a>
        </div>
      </details>
      <details>
        <summary>Set up ChatGPT</summary>
        <div className="mcp-setup-steps">
          <ol>
            <li>On ChatGPT web, enable <strong>Developer mode</strong> in <strong>Settings → Security and login</strong>. Some accounts still show this under <strong>Settings → Apps → Advanced Settings</strong>.</li>
            <li>Open <a href="https://chatgpt.com/plugins" target="_blank" rel="noopener noreferrer">Plugins</a> and select <strong>+</strong> to add an MCP server. In the Apps interface, use <strong>Create app</strong>. Name it <strong>Generative Arcana</strong> and paste the MCP server URL above.</li>
            <li>Choose <strong>OAuth</strong>. Arcana supports ChatGPT’s published client identity (CIMD); use that discovered connection without manually supplying a client ID or secret. Complete Arcana sign-in and review the requested permissions.</li>
            <li>Start a new chat and choose Arcana from the <strong>+</strong> menu (under <strong>More</strong> in some interfaces). Then try the connection check below.</li>
          </ol>
          <p>Availability, publishing permissions, and read/write tools depend on your account and workspace policy. If Developer mode or creation is missing, ask your workspace administrator or check the current guide.</p>
          <p>If ChatGPT requires a client ID/secret or can’t use published identity, stop and contact the Arcana operator. Arcana doesn’t support open dynamic client registration. Don’t paste your Arcana password or an access token into those fields.</p>
          <a href="https://developers.openai.com/plugins/deploy/connect-chatgpt" target="_blank" rel="noopener noreferrer">ChatGPT’s current setup guide ↗</a>
        </div>
      </details>
    </div>
    <div className="mcp-setup-check">
      <h3>Check the connection</h3>
      <p>Select Arcana in your assistant, then send this read-only prompt:</p>
      <CopyValue label="Connection check prompt" value={CONNECTION_CHECK} button="Copy prompt" multiline />
      <p>An empty deck list is fine for a new account. The authoring guide and public tools can work before sign-in; your private library and changes require a separate account authorization. Signing in here alone doesn’t connect your assistant.</p>
      <p>Sign in through Arcana’s login page using the same account, and only approve permissions you trust. Never paste passwords, access tokens, or client secrets into a conversation. You can review or disconnect access in <a href="#/account/connections">Account → Connected clients</a>. Signing out of Arcana also ends connections authorized during that sign-in.</p>
    </div>
  </section>;
}

function CopyValue({ label, value, button, multiline = false }: { label: string; value: string; button: string; multiline?: boolean }) {
  const id = useId();
  const [state, setState] = useState<"idle" | "pending" | "copied" | "error">("idle");
  const active = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function copy() {
    if (active.current) return;
    active.current = true;
    setState("pending");
    try {
      await navigator.clipboard.writeText(value);
      if (mounted.current) setState("copied");
    } catch {
      if (mounted.current) setState("error");
    } finally { active.current = false; }
  }

  return <div className="mcp-copy">
    <label htmlFor={id}>{label}</label>
    <div className={`mcp-copy-row${multiline ? " mcp-copy-prompt" : ""}`}>
      {multiline
        ? <textarea id={id} readOnly value={value} rows={4} onFocus={(event) => event.currentTarget.select()} />
        : <input id={id} readOnly value={value} spellCheck={false} onFocus={(event) => event.currentTarget.select()} />}
      <button className="account-button account-secondary" type="button" disabled={state === "pending"} onClick={() => void copy()}>{state === "pending" ? "Copying…" : button}</button>
    </div>
    <div className="mcp-copy-status" role="status">{state === "copied" ? `${label} copied.` : ""}</div>
    {state === "error" && <p className="mcp-copy-error" role="alert">Couldn’t copy automatically. Select the text above and copy it manually.</p>}
  </div>;
}
