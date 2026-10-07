import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { readParlorCapabilities, type ParlorCapabilities } from './hosted';
import "./parlor.css";

export function Parlor({ onShowChange }: { onShowChange(showing: boolean): void }) {
  const { session, signIn, refresh } = useBrowserSession();
  if (session.status !== "authenticated" || !session.accountId) return <section className="parlor parlor-gate">
    <p className="parlor-eyebrow">Generative Arcana · After dark</p><h1>The parlor</h1>
    <p>{session.status === "loading" ? "Checking your invitation…" : "Sign in to host a reading at your private table."}</p>
    {session.status !== "loading" && <><button onClick={() => signIn("/parlor")}>Sign in to enter</button><button onClick={() => void refresh()}>Check account again</button></>}
  </section>;
  return <ParlorAccess key={session.accountId} accountId={session.accountId} onShowChange={onShowChange} />;
}

function ParlorAccess(props:{accountId:string;onShowChange(showing:boolean):void}) {
  const [capabilities,setCapabilities]=useState<ParlorCapabilities|null>(null);
  const [error,setError]=useState('');const [attempt,setAttempt]=useState(0);
  useEffect(()=>{const controller=new AbortController();setError('');void readParlorCapabilities(controller.signal).then(value=>{if(!controller.signal.aborted)setCapabilities(value);}).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Parlor unavailable.');});return()=>controller.abort();},[attempt]);
  if(!capabilities)return <section className="parlor parlor-gate"><h1>The parlor</h1><p role={error?'alert':'status'}>{error||'Checking parlor access.'}</p>{error&&<button onClick={()=>setAttempt(n=>n+1)}>Check parlor access again</button>}</section>;
  return <Host {...props} capabilities={capabilities}/>;
}
function Host({ accountId, onShowChange, capabilities }: { accountId: string; onShowChange(showing: boolean): void; capabilities:ParlorCapabilities }) {
  const hosted=capabilities.mode==='hosted';
  const [restored] = useState(() => {
    if(hosted){const first=capabilities.models[0];return {settings:{...defaultSettings(),hosted:true,provider:first.provider,anthropicModel:capabilities.models.find(m=>m.provider==='anthropic')?.id??'',openaiModel:capabilities.models.find(m=>m.provider==='openai')?.id??''},remember:false};}
    try { return readSettings(window.localStorage, accountId); } catch { return { settings: defaultSettings(), remember: false }; }
  });
  const [settings, setSettings] = useState(restored.settings);
  const [remember, setRemember] = useState(restored.remember);
  const [storageError, setStorageError] = useState(false);
  const [decks, setDecks] = useState<CatalogDeckSummary[]>([]);
  const [deckId, setDeckId] = useState("");
  const [status, setStatus] = useState("loading");
  const [attempt, setAttempt] = useState(0);
  const [hosting, setHosting] = useState(false);
  const [showError, setShowError] = useState("");
  const startButton = useRef<HTMLButtonElement>(null);
  const showing = useRef(false);
  useLayoutEffect(() => {
    onShowChange(hosting);
    if (hosting) document.scrollingElement?.scrollTo({ top: 0 });
    if (!hosting && showing.current) startButton.current?.focus();
    showing.current = hosting;
    return () => onShowChange(false);
  }, [hosting, onShowChange]);
  useEffect(() => {
    if (!hosting) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); setHosting(false); }
    };
    const leave = () => setHosting(false);
    window.addEventListener("keydown", exit);
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("keydown", exit); window.removeEventListener("pagehide", leave); };
  }, [hosting]);
  useEffect(() => {
    const abort = new AbortController(); setStatus("loading");
    void listMyDecks(abort.signal).then((items) => { if (!abort.signal.aborted) { setDecks(items); setDeckId((previous) => items.some((deck) => deck.id === previous) ? previous : items[0]?.id ?? ""); setStatus("ready"); } })
      .catch(() => { if (!abort.signal.aborted) setStatus("error"); });
    return () => abort.abort();
  }, [attempt]);
  const update = (next: Settings, persist = remember) => {
    setSettings(next); setRemember(persist);
    if(hosted)return;
    try { setStorageError(!saveSettings(window.localStorage, accountId, next, persist)); } catch { setStorageError(true); }
  };
  return <section className={`parlor${hosting ? " parlor-show" : ""}`} aria-label={hosting ? "Parlor show" : "Parlor setup"}>

    {!hosting &&
    <div className="parlor-heading"><div><p className="parlor-eyebrow">Generative Arcana · After dark</p><h1>The parlor</h1></div>
    </div>}
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
      {hosted?<><div><h2>The reader</h2><p>Hosted parlor · access and usage limits are managed by the server.</p>
        <label>Hosted model<select aria-label="Hosted model" value={`${settings.provider}:${settings.provider==='anthropic'?settings.anthropicModel:settings.openaiModel}`} onChange={event=>{const choice=capabilities.models.find(m=>`${m.provider}:${m.id}`===event.target.value)!;update({...settings,provider:choice.provider,...(choice.provider==='anthropic'?{anthropicModel:choice.id}:{openaiModel:choice.id})});}}>{capabilities.models.map(m=><option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>{m.provider} · {m.id}</option>)}</select></label></div>
        <div><h2>The voice</h2><label>Hosted voice<select aria-label="Hosted voice" value={settings.voiceId} onChange={event=>update({...settings,voiceId:event.target.value})}><option value="">Silent</option>{capabilities.voices.map(voice=><option key={voice} value={voice}>{voice}</option>)}</select></label><p>Hosted provider keys are never sent to this browser. Previously remembered browser-mode keys can be removed by clearing site data. Retries consume a new usage reservation, including after an interrupted request.</p></div></>:
      <><div><h2>The reader</h2><p>Browser-key mode · your own provider credentials.</p><label>Language provider<select aria-label="Language provider" value={settings.provider} onChange={(event) => update({ ...settings, provider: event.target.value as Settings["provider"] })}><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select></label>
        <KeyInput label="Anthropic API key" value={settings.anthropicKey} change={(value) => update({ ...settings, anthropicKey: value })} />
        <label>Anthropic model ID<input value={settings.anthropicModel} onChange={(event) => update({ ...settings, anthropicModel: event.target.value })} maxLength={160} placeholder="Enter a model available to your account" /></label>
        <KeyInput label="OpenAI API key" value={settings.openaiKey} change={(value) => update({ ...settings, openaiKey: value })} />
        <label>OpenAI model ID<input value={settings.openaiModel} onChange={(event) => update({ ...settings, openaiModel: event.target.value })} maxLength={160} placeholder="Enter a chat-completions compatible model" /></label>
      </div>
      <div><h2>The voice</h2><p>Optional. Leave the voice key empty for a silent show.</p>
        <KeyInput label="ElevenLabs API key" value={settings.elevenKey} change={(value) => update({ ...settings, elevenKey: value })} />
        <label>ElevenLabs voice ID<input value={settings.voiceId} onChange={(event) => update({ ...settings, voiceId: event.target.value })} maxLength={160} /></label>
        <p className="parlor-warning">Keys are masked on screen, not encrypted. This browser and same-origin scripts can read them. Anyone using this device may access remembered keys. Login does not protect localStorage. Provider calls go directly from this browser. ElevenLabs discourages browser API keys; audio may be unavailable.</p>
        <label className="parlor-check"><input type="checkbox" checked={remember} onChange={(event) => update(settings, event.target.checked)} />Remember keys on this device (plaintext)</label>
        <button onClick={() => update(clearKeys(settings), false)}>Clear keys from this device</button>
        {storageError && <p role="alert">Browser storage could not be updated. Keys work in memory, but previously saved keys may remain; clear site data in your browser.</p>}
      </div></>}
    </div>}
    {!hosting && showError && <p role="alert">{showError}</p>}
    {deckId && <RemoteDeckBoundary key={deckId} deckId={deckId} routeKey="/parlor">
      <TableSetup deckId={deckId} settings={settings} hosting={hosting} start={() => { setShowError(""); setHosting(true); }} fail={(error) => { setShowError(error); setHosting(false); }} startButton={startButton} />
    </RemoteDeckBoundary>}
  </section>;
}
function KeyInput({ label, value, change }: { label: string; value: string; change(value: string): void }) {
  return <label>{label}<input type="password" value={value} onChange={(event) => change(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={4096} data-1p-ignore data-lpignore="true" /></label>;
}
function TableSetup({ deckId, settings, hosting, start, fail, startButton }: { deckId: string; settings: Settings; hosting: boolean; start(): void; fail(error: string): void; startButton: React.RefObject<HTMLButtonElement> }) {
  const [question, setQuestion] = useState("");
  useLayoutEffect(() => { if (!hosting) setQuestion(""); }, [hosting]);
  const artwork = useArtworkSelection();
  const deck = getDeck(deckId)!;
  const ready = !!question.trim() && readySettings(settings) && deck.cards.length >= 3 && (!artwork || (artwork.resolved && !!artwork.packId));
  if (hosting) return <Ritual key={`${deckId}:${artwork?.packId ?? ""}`} deckId={deckId} settings={settings} question={question} fail={fail} />;
  return <div className="parlor-launch">
    {artwork && <label>Artwork set<select aria-label="Artwork set" value={artwork.packId} disabled={!artwork.resolved} onChange={(event) => artwork.selectPack(event.target.value)}>
      {!artwork.packId && <option value="">Choose an artwork set</option>}
      {!artwork.visiblePacks.length && <option value="">Authored card faces</option>}
      {artwork.visiblePacks.map((pack) => <option key={pack.id} value={pack.id}>{pack.label}</option>)}
    </select></label>}
    {artwork?.status === "error" && <p role="alert">Artwork could not be checked. <button onClick={artwork.refresh}>Retry artwork</button></p>}
    <p>Questions and conversation stay in memory here and clear for the next guest. Your selected provider receives the question and deck context; ElevenLabs receives narration when enabled. Their retention policies apply. This app does not save guest readings.</p>
    {deck.cards.length < 3 && <p role="alert">Choose a deck with at least three cards.</p>}
    <label>What would you like to explore?<textarea value={question} onChange={event => setQuestion(event.target.value)} maxLength={1200} /></label>
    <button ref={startButton} className="parlor-primary" aria-disabled={!ready} onClick={() => { if (ready) start(); }}>Start the show</button>
    <p className="parlor-show-hint">Starting confirms your question. Only the cards appear; reveals and optional audio continue automatically. Press Escape to stop, clear the reading and return to setup. Without a keyboard, use browser Back. For reflection and entertainment.</p>
  </div>;
}
function Ritual({ deckId, settings, question, fail }: { deckId: string; settings: Settings; question: string; fail(error: string): void }) {
  const artwork = useArtworkStore();
  const machine = useMemo(() => new ParlorMachine(deckId, settings, { preload: async (reading) => {
    await Promise.all(reading.cards.map((card) => artwork?.load(card.slug)));
  } }), [deckId, settings, artwork]);
  const state = useSyncExternalStore(machine.subscribe, machine.getSnapshot, machine.getSnapshot);
  const [back, setBack] = useState<PackArtworkAsset | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { stage.current?.focus({ preventScroll: true }); return () => machine.dispose(); }, [machine]);
  useEffect(() => { machine.begin(); machine.question(question); machine.review(); machine.confirm(); }, [machine, question]);
  useEffect(() => {
    if (state.phase === "ready") machine.next(false);
    if (state.phase === "error") fail(state.error);
  }, [machine, state.phase, state.segment, state.error, fail]);
  useEffect(() => {
    const abort = new AbortController();
    if (artwork?.packId) void getPackArtworkAsset(deckId, "cardBack", abort.signal, artwork.packId).then(asset => { if (!abort.signal.aborted) setBack(asset); }).catch(() => {});
    return () => abort.abort();
  }, [deckId, artwork]);
  return <div ref={stage} tabIndex={-1} className="parlor-ritual" aria-label="Cards-only reading">
    {state.reading && (
      <div className="parlor-table" aria-label="Three-card reading">
        {state.reading.placements.map((placement, index) => <figure key={placement.card.slug}>
          <div className={`parlor-card ${index < state.revealed ? "is-revealed" : ""}`} aria-label={index < state.revealed ? `${placement.card.name}, ${placement.reversed ? "reversed" : "upright"}` : `Card ${index + 1}, face down`}>
            <div className="parlor-card-turn">
              <div className="parlor-card-back" aria-hidden={index < state.revealed}><PackAssetImage asset={back} scope={artwork} alt="Selected artwork set card back" fallback={<span className="parlor-back-symbol" aria-hidden>✦<br />☾<br />✦</span>} /></div>
              <div className="parlor-card-front" aria-hidden={index >= state.revealed}>{index < state.revealed && <div style={{ position: "absolute", inset: 0, transform: placement.reversed ? "rotate(180deg)" : undefined }}><CardArt card={placement.card} deckId={deckId} deck={state.reading!.deck.data} mode="poster" /></div>}</div>
            </div>
          </div>

        </figure>)}
      </div>
    )}
  </div>;
}
