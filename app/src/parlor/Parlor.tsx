import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useBrowserSession } from "../auth/session";
import { listMyDecks, type CatalogDeckSummary } from "../catalog/api";
import { RemoteDeckBoundary } from "../app/RemoteDeckBoundary";
import { getDeck } from "../decks";
import { CardArt } from "../components/CardArt";
import { PackAssetImage } from "../artwork/PackAssetImage";
import { getPackArtworkAsset, type PackArtworkAsset } from "../artwork/api";
import { useArtworkSelection, useArtworkStore } from "../artwork/context";
import { characters, clearKeys, defaultSettings, readSettings, readySettings, saveSettings, type Settings } from "./settings";
import { ParlorMachine } from "./machine";
import "./parlor.css";

export function Parlor() {
  const { session, signIn, refresh } = useBrowserSession();
  if (session.status !== "authenticated" || !session.accountId) return <section className="parlor parlor-gate">
    <p className="parlor-eyebrow">Generative Arcana · After dark</p><h1>The parlor</h1>
    <p>{session.status === "loading" ? "Checking your invitation…" : "Sign in to host a reading at your private table."}</p>
    {session.status !== "loading" && <><button onClick={() => signIn("/parlor")}>Sign in to enter</button><button onClick={() => void refresh()}>Check account again</button></>}
  </section>;
  return <Host key={session.accountId} accountId={session.accountId} />;
}

function Host({ accountId }: { accountId: string }) {
  const [restored] = useState(() => { try { return readSettings(window.localStorage, accountId); } catch { return { settings: defaultSettings(), remember: false }; } });
  const [settings, setSettings] = useState(restored.settings);
  const [remember, setRemember] = useState(restored.remember);
  const [storageError, setStorageError] = useState(false);
  const [decks, setDecks] = useState<CatalogDeckSummary[]>([]);
  const [deckId, setDeckId] = useState("");
  const [status, setStatus] = useState("loading");
  const [attempt, setAttempt] = useState(0);
  const [hosting, setHosting] = useState(false);
  useEffect(() => {
    const abort = new AbortController(); setStatus("loading");
    void listMyDecks(abort.signal).then((items) => { if (!abort.signal.aborted) { setDecks(items); setDeckId((previous) => items.some((deck) => deck.id === previous) ? previous : items[0]?.id ?? ""); setStatus("ready"); } })
      .catch(() => { if (!abort.signal.aborted) setStatus("error"); });
    return () => abort.abort();
  }, [attempt]);
  const update = (next: Settings, persist = remember) => {
    setSettings(next); setRemember(persist);
    try { setStorageError(!saveSettings(window.localStorage, accountId, next, persist)); } catch { setStorageError(true); }
  };
  return <section className="parlor">
    <div className="parlor-heading"><div><p className="parlor-eyebrow">Generative Arcana · After dark</p><h1>The parlor</h1></div>
      {hosting && <button onClick={() => setHosting(false)}>Host settings · end reading</button>}</div>
    {!hosting && <div className="parlor-settings">
      <div><h2>Set the table</h2><p>Choose a deck, a storyteller, and the voice of the evening.</p>
        <label>Deck<select aria-label="Deck" value={deckId} onChange={(event) => setDeckId(event.target.value)} disabled={status !== "ready"}>
          {!decks.length && <option value="">{status === "loading" ? "Loading your decks…" : "No account decks available"}</option>}
          {decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
        </select></label>
        {status === "error" && <p role="alert">Could not load your decks. <button onClick={() => setAttempt((value) => value + 1)}>Retry decks</button></p>}
        <label>Storyteller<select aria-label="Storyteller" value={settings.character} onChange={(event) => update({ ...settings, character: event.target.value as Settings["character"] })}>
          {Object.entries(characters).map(([id, character]) => <option key={id} value={id}>{character.name}</option>)}
        </select></label>
      </div>
      <div><h2>The reader</h2><label>Language provider<select aria-label="Language provider" value={settings.provider} onChange={(event) => update({ ...settings, provider: event.target.value as Settings["provider"] })}><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select></label>
        <KeyInput label="Anthropic API key" value={settings.anthropicKey} change={(value) => update({ ...settings, anthropicKey: value })} />
        <label>Anthropic model ID<input value={settings.anthropicModel} onChange={(event) => update({ ...settings, anthropicModel: event.target.value })} maxLength={160} placeholder="Enter a model available to your account" /></label>
        <KeyInput label="OpenAI API key" value={settings.openaiKey} change={(value) => update({ ...settings, openaiKey: value })} />
        <label>OpenAI model ID<input value={settings.openaiModel} onChange={(event) => update({ ...settings, openaiModel: event.target.value })} maxLength={160} placeholder="Enter a chat-completions compatible model" /></label>
      </div>
      <div><h2>The voice</h2><p>Optional. Leave the voice key empty for captions only.</p>
        <KeyInput label="ElevenLabs API key" value={settings.elevenKey} change={(value) => update({ ...settings, elevenKey: value })} />
        <label>ElevenLabs voice ID<input value={settings.voiceId} onChange={(event) => update({ ...settings, voiceId: event.target.value })} maxLength={160} /></label>
        <p className="parlor-warning">Keys are masked on screen, not encrypted. This browser and same-origin scripts can read them. Anyone using this device may access remembered keys. Login does not protect localStorage. Provider calls go directly from this browser. ElevenLabs discourages browser API keys; audio may be unavailable.</p>
        <label className="parlor-check"><input type="checkbox" checked={remember} onChange={(event) => update(settings, event.target.checked)} />Remember keys on this device (plaintext)</label>
        <button onClick={() => update(clearKeys(settings), false)}>Clear keys from this device</button>
        {storageError && <p role="alert">Browser storage could not be updated. Keys work in memory, but previously saved keys may remain; clear site data in your browser.</p>}
      </div>
    </div>}
    {deckId && <RemoteDeckBoundary key={deckId} deckId={deckId} routeKey="/parlor">
      <TableSetup deckId={deckId} settings={settings} hosting={hosting} start={() => setHosting(true)} />
    </RemoteDeckBoundary>}
  </section>;
}
function KeyInput({ label, value, change }: { label: string; value: string; change(value: string): void }) {
  return <label>{label}<input type="password" value={value} onChange={(event) => change(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={4096} data-1p-ignore data-lpignore="true" /></label>;
}
function TableSetup({ deckId, settings, hosting, start }: { deckId: string; settings: Settings; hosting: boolean; start(): void }) {
  const artwork = useArtworkSelection();
  const deck = getDeck(deckId)!;
  const ready = readySettings(settings) && deck.cards.length >= 3 && (!artwork || (artwork.resolved && !!artwork.packId));
  if (hosting) return <Ritual key={`${deckId}:${artwork?.packId ?? ""}`} deckId={deckId} settings={settings} />;
  return <div className="parlor-launch">
    {artwork && <label>Artwork set<select aria-label="Artwork set" value={artwork.packId} disabled={!artwork.resolved} onChange={(event) => artwork.selectPack(event.target.value)}>
      {!artwork.packId && <option value="">Choose an artwork set</option>}
      {!artwork.visiblePacks.length && <option value="">Authored card faces</option>}
      {artwork.visiblePacks.map((pack) => <option key={pack.id} value={pack.id}>{pack.label}</option>)}
    </select></label>}
    {artwork?.status === "error" && <p role="alert">Artwork could not be checked. <button onClick={artwork.refresh}>Retry artwork</button></p>}
    <p>Questions and conversation stay in memory here and clear for the next guest. Your selected provider receives the question and deck context; ElevenLabs receives narration when enabled. Their retention policies apply. This app does not save guest readings.</p>
    {deck.cards.length < 3 && <p role="alert">Choose a deck with at least three cards.</p>}
    <button className="parlor-primary" disabled={!ready} onClick={start}>Open the parlor</button>
  </div>;
}
function Ritual({ deckId, settings }: { deckId: string; settings: Settings }) {
  const artwork = useArtworkStore();
  const machine = useMemo(() => new ParlorMachine(deckId, settings, { preload: async (reading) => {
    // Three loads only; existing store owns cancellation and URLs. No duplicate renderer cache.
    await Promise.all(reading.cards.map((card) => artwork?.load(card.slug)));
  } }), [deckId, settings, artwork]);
  const state = useSyncExternalStore(machine.subscribe, machine.getSnapshot, machine.getSnapshot);
  const [muted, setMuted] = useState(false);
  const [followup, setFollowup] = useState("");
  const [back, setBack] = useState<PackArtworkAsset | null>(null);
  useLayoutEffect(() => () => machine.dispose(), [machine]);
  useEffect(() => {
    const abort = new AbortController(); setBack(null);
    if (artwork?.packId) void getPackArtworkAsset(deckId, "cardBack", abort.signal, artwork.packId).then((asset) => { if (!abort.signal.aborted) setBack(asset); }).catch(() => {});
    return () => abort.abort();
  }, [deckId, artwork]);
  // A page can enter the browser's back/forward cache with its JS heap intact.
  useLayoutEffect(() => {
    const clear = () => { machine.reset(); setFollowup(""); };
    window.addEventListener("pagehide", clear);
    return () => window.removeEventListener("pagehide", clear);
  }, [machine]);
  const busy = ["drawing", "generating", "speaking", "conversation"].includes(state.phase);
  return <div className="parlor-ritual" onClickCapture={(event) => {
    // A fast response can replace Retry with Pause underneath the second half of a double click.
    if (event.detail > 1) { event.preventDefault(); event.stopPropagation(); }
  }}>
    <div className="parlor-toolbar"><p>{characters[settings.character].name}</p><div>
      <button aria-pressed={muted} onClick={() => { const next = !muted; setMuted(next); if (next && state.phase === "speaking") machine.captions(); }}>{muted ? "Unmute" : "Mute"}</button>
      <button onClick={() => { machine.reset(); setFollowup(""); }}>Next guest</button>
    </div></div>
    {state.phase === "greeting" && <div className="parlor-intro"><div className="parlor-sigil" aria-hidden>☾</div><h2>A seat between worlds</h2><p>{characters[settings.character].greeting}</p><button className="parlor-primary" onClick={() => machine.begin()}>Take a seat</button><small>For reflection and entertainment. You may stop at any time.</small></div>}
    {state.phase === "question" && <form className="parlor-question" onSubmit={(event) => { event.preventDefault(); machine.review(); }}><label>What would you like to explore?<textarea value={state.question} onChange={(event) => machine.question(event.target.value)} maxLength={1200} autoFocus /></label><button className="parlor-primary" disabled={!state.question.trim()}>Bring this question</button></form>}
    {state.phase === "confirm" && <div className="parlor-question"><h2>Shall we ask the cards?</h2><blockquote>{state.question}</blockquote><button onClick={() => machine.edit()}>Edit question</button><button className="parlor-primary" onClick={() => machine.confirm()}>Confirm & deal three cards</button></div>}
    {state.reading && <>
      <div className="parlor-table" aria-label="Three-card reading">
        {state.reading.placements.map((placement, index) => <figure key={placement.card.slug}>
          <div className={`parlor-card ${index < state.revealed ? "is-revealed" : ""}`} aria-label={index < state.revealed ? `${placement.card.name}, ${placement.reversed ? "reversed" : "upright"}` : `Card ${index + 1}, face down`}>
            <div className="parlor-card-turn">
              <div className="parlor-card-back" aria-hidden={index < state.revealed}><PackAssetImage asset={back} scope={artwork} alt="Selected artwork set card back" fallback={<span className="parlor-back-symbol" aria-hidden>✦<br />☾<br />✦</span>} /></div>
              <div className="parlor-card-front" aria-hidden={index >= state.revealed}>{index < state.revealed && <div style={{ position: "absolute", inset: 0, transform: placement.reversed ? "rotate(180deg)" : undefined }}><CardArt card={placement.card} deckId={deckId} deck={state.reading!.deck.data} mode="poster" /></div>}</div>
            </div>
          </div>
          <figcaption><span>{placement.position.name}</span>{index < state.revealed && <><strong>{placement.card.name}</strong><small>{placement.reversed ? "Reversed" : "Upright"}</small></>}</figcaption>
        </figure>)}
      </div>
      <div className="parlor-caption" aria-live="polite" aria-atomic="true">{state.caption || "Three cards. Three doors. A moment before the first opens."}</div>
      {state.revealed > 0 && <details className="parlor-meanings"><summary>From the deck · authored meanings</summary>{state.reading.placements.slice(0, state.revealed).map((placement) => <p key={placement.card.slug}><strong>{placement.card.name}:</strong> {placement.meaning}</p>)}</details>}
    </>}
    <div className="parlor-actions">
      {busy && <><p role="status">{state.phase === "drawing" ? "Shuffling the deck…" : state.phase === "generating" ? "The reader considers your cards…" : state.phase === "speaking" ? "The voice is telling your story…" : "Considering your question…"}</p><button onClick={() => machine.cancel()}>Pause / interrupt</button></>}
      {state.phase === "ready" && <button className="parlor-primary" onClick={() => machine.next(muted)}>{state.segment < 3 ? `Reveal card ${state.segment + 1}` : "Hear the synthesis"}</button>}
      {["error", "paused"].includes(state.phase) && <><p role={state.error ? "alert" : "status"}>{state.error || "Paused. Your cards are waiting."}</p><button onClick={() => machine.retry(muted)}>Retry / resume</button>{state.narration && !state.pendingQuestion && <button onClick={() => machine.captions()}>Continue with captions</button>}</>}
    </div>
    {state.phase === "complete" && <div className="parlor-conversation"><h2>The story is yours to carry</h2>
      <p>Stay for a question, or welcome the next guest.</p>
      {state.turns.map((turn, index) => <p key={index}><strong>{turn.role === "user" ? "You" : characters[settings.character].name}:</strong> {turn.content}</p>)}
      <form onSubmit={(event) => { event.preventDefault(); machine.ask(followup); setFollowup(""); }}><label>Ask a follow-up (captions)<textarea value={followup} maxLength={1200} onChange={(event) => setFollowup(event.target.value)} /></label><button disabled={!followup.trim() || state.turns.length >= 20}>Ask the reader</button></form>
    </div>}
  </div>;
}
