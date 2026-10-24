import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useBrowserSession } from "../auth/session";
import { listMyDecks, type CatalogDeckSummary } from "../catalog/api";
import { RemoteDeckBoundary } from "../app/RemoteDeckBoundary";
import { getDeck } from "../decks";
import { CardArt } from "../components/CardArt";
import { PackAssetImage } from "../artwork/PackAssetImage";
import { getPackArtworkAsset, type PackArtworkAsset } from "../artwork/api";
import { useArtworkSelection, useArtworkStore } from "../artwork/context";
import { characters, clearKeys, defaultSettings, readSettings, readySettings, saveSettings, useOwnerEleven, type Settings } from "./settings";
import { ParlorMachine } from "./machine";
import { ScribeMicrophone, transcribeScribe } from "./microphone";
import { TableGestures, tableInput, tableKey, HOLD_MS, SUMMON_MS } from "./gestures";
import { RadioSignal } from "./RadioSignal";
import { radioState } from "./radio";
import { guestCue } from "./cue";
import { RadioAudio, defaultRadioPreferences, type RadioPreferences } from "./radioAudio";
import { readParlorCapabilities, ownerTranscribe, type ParlorCapabilities } from './hosted';
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
    const defaults={anthropicModel:capabilities.ownerKeys?.anthropicModel||'',voiceId:capabilities.ownerKeys?.voiceId||''};
    let saved;try { saved=readSettings(window.localStorage, accountId,defaults); } catch { saved={settings:{...defaultSettings(),...defaults},remember:false}; }
    return {...saved,settings:{...saved.settings,ownerKeys:capabilities.ownerKeys}};
  });
  const [settings, setSettings] = useState<Settings>(restored.settings);
  const [remember, setRemember] = useState(restored.remember);
  const [storageError, setStorageError] = useState(false);
  const [decks, setDecks] = useState<CatalogDeckSummary[]>([]);
  const [deckId, setDeckId] = useState("");
  const [status, setStatus] = useState("loading");
  const [attempt, setAttempt] = useState(0);
  const [hosting, setHosting] = useState(false);
  const [radioPreferences, setRadioPreferences] = useState(defaultRadioPreferences);
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
      <><div><h2>The reader</h2><p>Entered keys take precedence; account fallbacks are shown below when available.</p><label>Language provider<select aria-label="Language provider" value={settings.provider} onChange={(event) => update({ ...settings, provider: event.target.value as Settings["provider"] })}><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select></label>
        <KeyInput label="Anthropic API key" value={settings.anthropicKey} change={(value) => update({ ...settings, anthropicKey: value })} />
        {capabilities.ownerKeys?.anthropicModel&&<p>Your account defaults to {capabilities.ownerKeys.anthropicModel} with the Anthropic key left blank. You can select another Claude model available to the account. <button onClick={()=>update({...settings,provider:'anthropic',anthropicModel:capabilities.ownerKeys!.anthropicModel!})}>Use account model</button></p>}
        <label>Anthropic model ID<input value={settings.anthropicModel} onChange={(event) => update({ ...settings, anthropicModel: event.target.value })} maxLength={160} placeholder="Enter a model available to your account" /></label>
        <KeyInput label="OpenAI API key" value={settings.openaiKey} change={(value) => update({ ...settings, openaiKey: value })} />
        <label>OpenAI model ID<input value={settings.openaiModel} onChange={(event) => update({ ...settings, openaiModel: event.target.value })} maxLength={160} placeholder="Enter a chat-completions compatible model" /></label>
      </div>
      <div><h2>The voice</h2><p>{capabilities.ownerKeys?.elevenlabs?'Your account provides ElevenLabs narration and Scribe when the key below is blank. Keep your selected voice ID, or leave the voice ID blank for captions.':'Optional. Leave the voice key empty for a silent show.'}</p>
        <KeyInput label="ElevenLabs API key" value={settings.elevenKey} change={(value) => update({ ...settings, elevenKey: value })} />
        <label>ElevenLabs voice ID<input value={settings.voiceId} onChange={(event) => update({ ...settings, voiceId: event.target.value })} maxLength={160} /></label>
        {capabilities.ownerKeys?.voiceId&&<button onClick={()=>update({...settings,voiceId:capabilities.ownerKeys!.voiceId!})}>Use account voice</button>}
        <p className="parlor-warning">Entered keys are masked on screen, not encrypted. This browser and same-origin scripts can read them. Anyone using this device may access remembered keys. Login does not protect localStorage. Entered-key calls go directly from this browser; account-provider calls go through the authenticated server. Server keys are never sent here.</p>
        <label className="parlor-check"><input type="checkbox" checked={remember} onChange={(event) => update(settings, event.target.checked)} />Remember keys on this device (plaintext)</label>
        <button onClick={() => update(clearKeys(settings), false)}>Clear keys from this device</button>
        {storageError && <p role="alert">Browser storage could not be updated. Keys work in memory, but previously saved keys may remain; clear site data in your browser.</p>}
      </div></>}
    </div>}
    {deckId && <RemoteDeckBoundary key={deckId} deckId={deckId} routeKey="/parlor">
      <TableSetup deckId={deckId} settings={settings} hosting={hosting} start={() => setHosting(true)} leave={() => setHosting(false)} startButton={startButton} radioPreferences={radioPreferences} changeRadio={setRadioPreferences} />
    </RemoteDeckBoundary>}
  </section>;
}
function KeyInput({ label, value, change }: { label: string; value: string; change(value: string): void }) {
  return <label>{label}<input type="password" value={value} onChange={(event) => change(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={4096} data-1p-ignore data-lpignore="true" /></label>;
}
type RadioOptions = { radioPreferences: RadioPreferences; changeRadio(value: RadioPreferences): void };
function RadioControls({ radioPreferences, changeRadio }: RadioOptions) {
  return <div className="parlor-radio-controls" data-parlor-operator>
    <label className="parlor-check"><input type="checkbox" checked={radioPreferences.muted} onChange={event => changeRadio({ ...radioPreferences, muted: event.target.checked })} />Mute radio ambience</label>
    <label>Radio ambience volume<input type="range" min="0" max="100" step="1" value={Math.round(radioPreferences.volume * 100)} onChange={event => changeRadio({ ...radioPreferences, volume: Number(event.target.value) / 100 })} /></label>
    <p>Quiet hum and static. Lower beneath the spirit; silent while you speak. Changes last for this hosting session.</p>
  </div>;
}
function TableSetup({ deckId, settings, hosting, start, leave, startButton, radioPreferences, changeRadio }: { deckId: string; settings: Settings; hosting: boolean; start(): void; leave(): void; startButton: React.RefObject<HTMLButtonElement> } & RadioOptions) {
  const [operatorControls, setOperatorControls] = useState(false);
  const artwork = useArtworkSelection();
  const deck = getDeck(deckId)!;
  const ready = readySettings(settings) && deck.cards.length >= 3 && (!artwork || (artwork.resolved && !!artwork.packId));
  if (hosting) return <Ritual key={`${deckId}:${artwork?.packId ?? ""}`} deckId={deckId} settings={settings} leave={leave} radioPreferences={radioPreferences} changeRadio={changeRadio} operatorControls={operatorControls} />;
  return <div className="parlor-launch">
    {artwork && <label>Artwork set<select aria-label="Artwork set" value={artwork.packId} disabled={!artwork.resolved} onChange={(event) => artwork.selectPack(event.target.value)}>
      {!artwork.packId && <option value="">Choose an artwork set</option>}
      {!artwork.visiblePacks.length && <option value="">Authored card faces</option>}
      {artwork.visiblePacks.map((pack) => <option key={pack.id} value={pack.id}>{pack.label}</option>)}
    </select></label>}
    {artwork?.status === "error" && <p role="alert">Artwork could not be checked. <button onClick={artwork.refresh}>Retry artwork</button></p>}
    <p>Questions and conversation stay in memory here and clear for the next guest. Your selected provider receives the question and deck context; ElevenLabs receives narration when enabled. Their retention policies apply. This app does not save guest readings.</p>
    {deck.cards.length < 3 && <p role="alert">Choose a deck with at least three cards.</p>}
    <p>Hold to talk records only while held. On release, that clip goes to ElevenLabs Scribe using your ElevenLabs key and incurs transcription usage. Its transcript goes to your selected reader. Provider retention policies apply.</p>
    <RadioControls radioPreferences={radioPreferences} changeRadio={changeRadio} />
    <label className="parlor-check"><input type="checkbox" checked={operatorControls} onChange={event => setOperatorControls(event.target.checked)} />Show operator controls while testing</label>
    <button ref={startButton} className="parlor-primary" aria-disabled={!ready} onClick={() => { if (ready) start(); }}>Start the show</button>
    <p className="parlor-show-hint">The idle table waits for a seven-second hold to summon the spirit, without recording. Keep holding until the voice asks you to release. After its introduction, hold for 450 ms, wait for Speak now, speak and release. A quick tap moves on after a 500 ms pause; five quick taps with less than 500 ms between them return to blank idle. Overlapping keys count once. Escape returns to setup. Tab, modifier shortcuts and operator inputs keep their usual behavior. Test the mini keyboard and microphone on the party Mac before guests arrive.</p>
  </div>;
}
function Ritual({ deckId, settings, leave, radioPreferences, changeRadio, operatorControls }: { deckId: string; settings: Settings; leave(): void; operatorControls: boolean } & RadioOptions) {
  const artwork = useArtworkStore();
  const machine = useMemo(() => new ParlorMachine(deckId, settings, { preload: async (reading) => {
    await Promise.all(reading.cards.map((card) => artwork?.load(card.slug)));
  } }), [deckId, settings, artwork]);
  const state = useSyncExternalStore(machine.subscribe, machine.getSnapshot, machine.getSnapshot);
  const speechInputAvailable = !settings.hosted && (!!settings.elevenKey.trim() || useOwnerEleven(settings));
  const microphone = useMemo(() => new ScribeMicrophone(text => machine.submit(text), () => settings.hosted ? "" : settings.elevenKey, undefined,
    (audio,key,signal)=>useOwnerEleven(settings)?ownerTranscribe(audio,signal):transcribeScribe(audio,key,signal),
    ()=>!settings.hosted&&(!!settings.elevenKey.trim()||useOwnerEleven(settings))), [machine, settings]);
  const mic = useSyncExternalStore(microphone.subscribe, microphone.getSnapshot, microphone.getSnapshot);
  const sound = useMemo(() => new RadioAudio(), [machine]);
  const soundError = useSyncExternalStore(sound.subscribe, sound.getSnapshot, sound.getSnapshot);
  useLayoutEffect(() => { sound.setPreferences(radioPreferences); }, [sound, radioPreferences]);
  useLayoutEffect(() => {
    // Synchronous subscriptions duck before capture/playback, independently of React paint.
    const sync = () => { const input = microphone.getSnapshot(); sound.setState(radioState(machine.getSnapshot(), input).mode, input.phase === "checking" || input.phase === "listening"); };
    const offMachine = machine.subscribe(sync), offMic = microphone.subscribe(sync); sync();
    return () => { offMachine(); offMic(); };
  }, [machine, microphone, sound]);
  const controls = useMemo(() => new TableGestures({
    holdDelay: () => machine.getSnapshot().phase === "idle" ? SUMMON_MS : HOLD_MS,
    press: startedAt => { sound.hold(machine.getSnapshot().phase !== "idle"); machine.summon(startedAt); sound.unlock(); },
    lift: () => { machine.releaseSummon(); if (!["checking", "listening"].includes(microphone.getSnapshot().phase)) sound.hold(false); },
    captureTap: () => {
      const before = machine.getSnapshot(), input = microphone.getSnapshot();
      if (!tableInput(before, input, speechInputAvailable).tap) return;
      return () => { if (machine.getSnapshot() === before && microphone.getSnapshot() === input) machine.advance(); };
    },
    captureHold: () => {
      const before = machine.getSnapshot(), input = microphone.getSnapshot();
      const intent = tableInput(before, input, speechInputAvailable).hold;
      if (intent === "summon") return () => machine.contact();
      if (intent === "speak") return () => { if (machine.getSnapshot() === before && microphone.getSnapshot() === input) void microphone.press(); };
    },
    hold: () => {}, release: () => { microphone.release(); sound.hold(false); },
    cancel: () => { sound.stop(); microphone.cancel(); machine.cancelSummon(); sound.hold(false); },
    reset: () => { sound.stop(); microphone.cancel(); machine.reset(); sound.hold(false); },
  }), [machine, microphone, sound, speechInputAvailable]);
  const [back, setBack] = useState<PackArtworkAsset | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { stage.current?.focus({ preventScroll: true }); return () => { sound.dispose(); controls.dispose(); microphone.dispose(); machine.dispose(); }; }, [machine, microphone, controls, sound]);
  useEffect(() => { if (state.phase === "idle") stage.current?.focus({ preventScroll: true }); }, [state.phase]);
  useEffect(() => {
    // Only the first card follows the spoken query. Later cards require an explicit action.
    if (state.phase === "ready" && state.segment === 0 && state.revealed === 0) machine.next();
  }, [machine, state.phase, state.segment, state.revealed]);
  useEffect(() => {
    const cancel = () => { sound.stop(); controls.cancel(); machine.cancel(); };
    const hidden = () => { if (document.hidden) cancel(); };
    const pointerUp = (event: PointerEvent) => controls.up(`pointer:${event.pointerId}`);
    const keyDown = (event: KeyboardEvent) => {
      const key = tableKey(event, event.target);
      if (!key) { if (["Escape", "Tab"].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) controls.cancel(); return; }
      event.preventDefault(); controls.down(key, event.repeat);
    };
    // Release a tracked physical key even if focus or modifier state changed meanwhile.
    const keyUp = (event: KeyboardEvent) => { const key = `key:${event.code || event.key}`; if (controls.owns(key)) { event.preventDefault(); controls.up(key); } };
    window.addEventListener("blur", cancel); window.addEventListener("pagehide", cancel);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("pointerup", pointerUp); window.addEventListener("keyup", keyUp);
    return () => { window.removeEventListener("blur", cancel); window.removeEventListener("pagehide", cancel); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("keydown", keyDown, true); window.removeEventListener("pointerup", pointerUp); window.removeEventListener("keyup", keyUp); };
  }, [machine, controls, sound]);
  useEffect(() => {
    const abort = new AbortController();
    if (artwork?.packId) void getPackArtworkAsset(deckId, "cardBack", abort.signal, artwork.packId).then(asset => { if (!abort.signal.aborted) setBack(asset); }).catch(() => {});
    return () => abort.abort();
  }, [deckId, artwork]);
  const cancelMic = () => { if (controls.active) controls.cancelGesture(); };
  const busy = ["drawing", "generating", "speaking", "conversation"].includes(state.phase);
  const idle = state.phase === "idle";
  const summoning = state.phase === "summoning";
  const contact = summoning || state.phase === "calling" || state.phase === "awaiting-release";
  const canTalk = tableInput(state, mic, speechInputAvailable).hold === "speak";
  const signal = radioState(state, mic);
  const cue = guestCue(state, mic, speechInputAvailable);
  return <div ref={stage} tabIndex={-1} className={`parlor-ritual${idle ? " parlor-idle" : ""}${summoning ? " parlor-summoning" : ""}`} aria-label="Interactive reading" aria-describedby="parlor-guest-cue" data-phase={state.phase}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) controls.cancel(); }}>
    <div className="parlor-scene">
    <RadioSignal signal={signal} startedAt={state.summonStartedAt} showLabel={false} />
    {!idle && !contact && <div className="parlor-user-transcript" aria-label="Your words" aria-live="polite">{state.userText}</div>}
    {state.reading && (
      <div className="parlor-table" aria-label="Three-card reading">
        {state.reading.placements.map((placement, index) => <figure key={placement.card.slug}>
          <div className={`parlor-card ${index < state.revealed ? "is-revealed" : ""}`} aria-label={index < state.revealed ? `${placement.card.name}, ${placement.reversed ? "reversed" : "upright"}` : `Card ${index + 1}, face down`}>
            <div className="parlor-card-turn">
              <div className="parlor-card-back" aria-hidden={index < state.revealed}><PackAssetImage asset={back} scope={artwork} alt="Selected artwork set card back" fallback={<span className="parlor-back-symbol" aria-hidden>✦<br />☾<br />✦</span>} /></div>
              <div className="parlor-card-front" aria-hidden={index >= state.revealed}>{index < state.revealed && <div className="parlor-artwork" style={{ transform: placement.reversed ? "rotate(180deg)" : undefined }}><CardArt card={placement.card} deckId={deckId} deck={state.reading!.deck.data} mode="poster" fit="contain" /></div>}</div>
            </div>
          </div>

        </figure>)}
      </div>
    )}
    {!state.reading && !idle && <div className="parlor-table parlor-spread-slots" aria-label="Three empty card spaces">{[0, 1, 2].map(index => <div key={index} className="parlor-slot" aria-hidden="true" />)}</div>}
    {!idle && <div className="parlor-caption" aria-label="Narrator transcript" aria-live="off">{state.caption}</div>}
    </div>
    <aside id="parlor-guest-cue" className="parlor-cue" aria-label="Table instructions" aria-description={cue.attention ? state.error || mic.error : undefined} role={cue.attention ? "alert" : "status"} aria-atomic="true">
      <p className="parlor-cue-title">{cue.title}</p>{cue.instruction && <p className="parlor-cue-detail">{cue.instruction}</p>}
    </aside>
    {operatorControls && !idle && <div className="parlor-operator-controls" data-parlor-operator aria-label="Operator controls">
      {/* Ordinary input is disabled while busy, but five taps must still reset.
          Keep focus on release: native disabled would blur and cancel transcription. */}
      <button className="parlor-operator-talk" aria-pressed={mic.phase === "listening"} aria-disabled={!canTalk}
        onPointerDown={event => { if (event.button !== 0 || !event.isPrimary) return; event.preventDefault(); event.currentTarget.focus(); try { event.currentTarget.setPointerCapture(event.pointerId); } catch {} controls.down("pointer:" + event.pointerId); }}
        onPointerUp={event => controls.up("pointer:" + event.pointerId)} onPointerCancel={cancelMic}
        onLostPointerCapture={event => { if (controls.owns("pointer:" + event.pointerId)) controls.cancelGesture(); }} onBlur={cancelMic} onContextMenu={event => event.preventDefault()}
        onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); controls.down("operator:" + event.key, event.repeat); } }}
        onKeyUp={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); controls.up("operator:" + event.key); } }}>Hold to talk</button>
      {!idle && state.timing === "segment" && <p>Timing is unavailable. Captions appear after each spoken segment.</p>}
      {!idle && state.timing === "silent" && <p>Reading without audio.</p>}
      {busy && <button data-parlor-operator onClick={() => { controls.cancel(); machine.cancel(); }}>Pause reading</button>}
      {(state.phase === "error" || state.phase === "paused") && <><button data-parlor-operator onClick={() => { microphone.cancel(); machine.retry(); sound.unlock(); }}>Retry this step</button>{machine.canReadWithoutAudio() && <button data-parlor-operator onClick={() => { microphone.cancel(); machine.captions(); sound.unlock(); }}>Read without audio</button>}</>}
      {!idle && <button data-parlor-operator onClick={() => { controls.cancel(); machine.cancel(); leave(); }}>Leave the table</button>}
      {state.error && <p role="alert">{state.error}</p>}
      {mic.error && <p role="alert">{mic.error}</p>}
      {mic.phase === "finishing" && <button data-parlor-operator onClick={() => controls.cancel()}>Cancel transcription</button>}
      {!idle && <details className="parlor-sound-options" data-parlor-operator><summary>Radio sound</summary><RadioControls radioPreferences={radioPreferences} changeRadio={next => { sound.setPreferences(next); changeRadio(next); if (!next.muted) sound.unlock(); }} />{soundError && <p role="status">{soundError}</p>}</details>}
    </div>}
  </div>;
}
