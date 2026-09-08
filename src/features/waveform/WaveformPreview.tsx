import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { audioApi, type AudioApi, type FrameRange, type WaveformMetadata, type WaveformResponseV2 } from "../../api";
import { Button } from "../../design-system";
import { WaveformCanvas, RangeOverlay, type WaveformAnalysis } from "./WaveformCanvas";
import { usePreviewController } from "./PreviewController";
import { fitRange, frameAt, requestedPoints, zoomRange } from "./geometry";
import "./WaveformPreview.css";

interface WaveformPreviewProps { rootId: string; assetId: string; displayName: string; api?: AudioApi; analysis?: WaveformAnalysis }
const message = (error: unknown) => error && typeof error === "object" && "message" in error ? String(error.message) : "Waveform could not be loaded.";

export function WaveformPreview(props: WaveformPreviewProps) {
  // Also isolate direct prop changes, independently of callers' React keys.
  return <WaveformView key={`${props.rootId}:${props.assetId}`} {...props} />;
}
function WaveformView({ rootId, assetId, displayName, api = audioApi, analysis }: WaveformPreviewProps) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, dpr: 1 });
  const [metadata, setMetadata] = useState<WaveformMetadata | null>(null);
  const [viewport, setViewport] = useState<FrameRange | null>(null);
  const [waveform, setWaveform] = useState<WaveformResponseV2 | null>(null);
  const [overview, setOverview] = useState<WaveformResponseV2 | null>(null);
  const [status, setStatus] = useState("MISSING");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selection, setSelection] = useState<FrameRange | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const { controller, state: preview } = usePreviewController();
  const owner = `${rootId}:${assetId}`;
  const helpId = useId();
  const failed = useRef(false);
  const fail = useCallback((reason: unknown) => {
    failed.current = true;
    setError(message(reason)); setWaveform(null); setOverview(null); controller.reset();
  }, [controller]);
  const drag = useRef<{ x: number; frame: number; range: FrameRange; pan: boolean } | null>(null);

  useEffect(() => { controller.claim(owner); return () => controller.release(owner); }, [controller, owner]);
  useEffect(() => {
    // A new owner can render once with the previous owner's external-store snapshot.
    if (preview.range && controller.snapshot() === preview) setPlayhead(preview.frame);
  }, [controller, preview]);
  useEffect(() => {
    const element = host.current; if (!element) return;
    const measure = () => setSize({ width: Math.max(0, element.getBoundingClientRect().width), dpr: window.devicePixelRatio || 1 });
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(element); window.addEventListener("resize", measure);
    // Moving between displays can change DPR without changing CSS width.
    let media: MediaQueryList | null = null;
    const watchDpr = () => { media?.removeEventListener("change", watchDpr); measure(); media = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`); media?.addEventListener("change", watchDpr); };
    watchDpr();
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); media?.removeEventListener("change", watchDpr); };
  }, []);

  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function prepare() {
      try {
        const result = await api.prepareWaveform(rootId, assetId, abort.signal);
        if (abort.signal.aborted) return;
        setStatus(result.state);
        if (result.state === "READY" && result.metadata) {
          const m = result.metadata;
          if (!Number.isSafeInteger(m.totalFrames) || m.totalFrames < 1 || ![1, 2].includes(m.channelCount) || m.sampleRate <= 0) throw new Error("Invalid waveform metadata.");
          setMetadata(m); setViewport({ startFrame: 0, endFrameExclusive: m.totalFrames });
        } else if (["MISSING", "QUEUED", "GENERATING"].includes(result.state)) timer = setTimeout(() => void prepare(), 200);
        else fail(new Error(result.errorCode ?? result.state));
      } catch (reason) { if (!abort.signal.aborted) fail(reason); }
    }
    void prepare();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [api, rootId, assetId, attempt, fail]);

  useEffect(() => {
    if (failed.current || !metadata || size.width <= 0) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      api.queryWaveform({ rootId, assetId, startFrame: 0, endFrameExclusive: metadata.totalFrames, targetPoints: requestedPoints(size.width, size.dpr, metadata.totalFrames), channelMode: "separate" }, abort.signal).then(
        value => { if (!abort.signal.aborted && !failed.current) setOverview(value); },
        reason => { if (!abort.signal.aborted) fail(reason); },
      );
    }, 60);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [api, rootId, assetId, metadata, size.width, size.dpr, fail]);
  useEffect(() => {
    if (failed.current || !viewport || size.width <= 0) return;
    const abort = new AbortController();
    setWaveform(null);
    const timer = setTimeout(() => {
      api.queryWaveform({ rootId, assetId, ...viewport, targetPoints: requestedPoints(size.width, size.dpr, viewport.endFrameExclusive - viewport.startFrame), channelMode: "separate" }, abort.signal).then(
        value => { if (!abort.signal.aborted && !failed.current) setWaveform(value); },
        reason => { if (!abort.signal.aborted) fail(reason); },
      );
    }, 60);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [api, rootId, assetId, viewport, size.width, size.dpr, fail]);

  useEffect(() => {
    const element = plot.current;
    if (!element || !viewport || !metadata) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.width : 1);
      setViewport(current => {
        if (!current) return current;
        const length = current.endFrameExclusive - current.startFrame;
        return event.shiftKey ? fitRange(current.startFrame + (delta || event.deltaX) / Math.max(1, bounds.width) * length, length, metadata.totalFrames)
          : zoomRange(current, Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))), Math.exp(Math.max(-1, Math.min(1, delta * 0.002))), metadata.totalFrames);
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [viewport, metadata]);

  function movePlayhead(frame: number) {
    if (!metadata) return;
    const next = Math.max(0, Math.min(metadata.totalFrames - 1, Math.round(frame)));
    setPlayhead(next);
    if (!controller.seek(next) && (preview.range || preview.loading)) controller.reset();
  }
  function resetView() { if (metadata) setViewport({ startFrame: 0, endFrameExclusive: metadata.totalFrames }); }
  async function loadPreview(play = false) {
    if (!metadata || error) return;
    const range = selection ?? { startFrame: playhead, endFrameExclusive: metadata.totalFrames };
    const loaded = await controller.load(api, owner, rootId, assetId, range);
    if (play && loaded) await controller.toggle();
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || !metadata) return;
    if (![" ", "ArrowLeft", "ArrowRight", "f", "F", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === " ") {
      if (preview.playing) void controller.toggle();
      else if ((!selection || (preview.range?.startFrame === selection.startFrame && preview.range?.endFrameExclusive === selection.endFrameExclusive)) && preview.range && playhead >= preview.range.startFrame && playhead < preview.range.endFrameExclusive) void controller.toggle();
      else void loadPreview(true);
    } else if (event.key === "Escape") setSelection(null);
    else if (event.key.toLowerCase() === "f") resetView();
    else movePlayhead(playhead + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? Math.round(metadata.sampleRate / 10) : 1));
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!viewport || !metadata || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = { x: event.clientX, frame: frameAt(viewport, (event.clientX - rect.left) / Math.max(1, rect.width)), range: viewport, pan: event.button === 1 || event.altKey };
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || !metadata) return;
    const d = drag.current; const rect = event.currentTarget.getBoundingClientRect();
    if (Math.abs(event.clientX - d.x) < 3) return;
    if (d.pan) setViewport(fitRange(d.range.startFrame - (event.clientX - d.x) / Math.max(1, rect.width) * (d.range.endFrameExclusive - d.range.startFrame), d.range.endFrameExclusive - d.range.startFrame, metadata.totalFrames));
    else { const frame = frameAt(d.range, (event.clientX - rect.left) / Math.max(1, rect.width)); setSelection(frame === d.frame ? null : { startFrame: Math.min(d.frame, frame), endFrameExclusive: Math.max(d.frame, frame) }); }
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const d = drag.current;
    if (Math.abs(event.clientX - d.x) < 3 && !d.pan) {
      if (!selection || d.frame < selection.startFrame || d.frame >= selection.endFrameExclusive) setSelection(null);
      movePlayhead(d.frame);
    }
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const fullRange = metadata ? { startFrame: 0, endFrameExclusive: metadata.totalFrames } : null;
  const visiblePlayhead = viewport && playhead >= viewport.startFrame && playhead <= viewport.endFrameExclusive;
  const markers = analysis?.assetId === assetId ? analysis.markers : [];
  return <section className="waveform-preview" aria-label={`Waveform preview for ${displayName}`}>
    <div className="waveform-preview-heading"><p>Waveform</p>{metadata && <span>{(metadata.totalFrames / metadata.sampleRate).toFixed(3)}s · {metadata.channelCount === 1 ? "Mono" : "Stereo"}</span>}</div>
    <div ref={host} className="waveform-container">
      {!metadata && !error && <p role="status">{status === "QUEUED" ? "Waveform queued…" : "Generating waveform…"}</p>}
      <div ref={plot} className="waveform-interactive" role="group" aria-label="Waveform navigation" aria-describedby={helpId} tabIndex={0} onKeyDown={keyDown} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; }} onDoubleClick={resetView}>
        {waveform && <WaveformCanvas waveform={waveform} width={size.width} dpr={size.dpr} />}
        {metadata && !waveform && !error && <p role="status">Loading range…</p>}
        {selection && viewport && <RangeOverlay className="waveform-selection" range={selection} viewport={viewport} />}
        {visiblePlayhead && viewport && <div className="waveform-playhead" aria-hidden="true" style={{ left: `${(playhead - viewport.startFrame) / (viewport.endFrameExclusive - viewport.startFrame) * 100}%` }} />}
        {viewport && markers.filter(m => Number.isSafeInteger(m.frame) && m.frame >= viewport.startFrame && m.frame < viewport.endFrameExclusive).map(m => <div key={m.id} className="waveform-marker" title={m.label} style={{ left: `${(m.frame - viewport.startFrame) / (viewport.endFrameExclusive - viewport.startFrame) * 100}%` }} />)}
      </div>
      {overview && viewport && fullRange && <div className="waveform-overview" role="slider" aria-label="Waveform viewport" tabIndex={0} aria-valuemin={0} aria-valuemax={metadata!.totalFrames} aria-valuenow={viewport.startFrame}
        onPointerDown={event => { const r = event.currentTarget.getBoundingClientRect(); const center = frameAt(fullRange, (event.clientX - r.left) / Math.max(1, r.width)); const length = viewport.endFrameExclusive - viewport.startFrame; setViewport(fitRange(center - length / 2, length, metadata!.totalFrames)); }}
        onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); const length = viewport.endFrameExclusive - viewport.startFrame; setViewport(fitRange(viewport.startFrame + (event.key === "ArrowLeft" ? -1 : 1) * Math.max(1, length / 10), length, metadata!.totalFrames)); } }}>
        <WaveformCanvas waveform={overview} width={size.width} dpr={size.dpr} height={64} overview />
        <RangeOverlay className="waveform-viewport" range={viewport} viewport={fullRange} />
      </div>}
    </div>
    <div className="waveform-preview-actions">
      {error && <Button type="button" variant="secondary" onClick={() => { failed.current = false; controller.reset(); setMetadata(null); setViewport(null); setWaveform(null); setOverview(null); setError(null); setStatus("MISSING"); setAttempt(value => value + 1); }}>Retry waveform</Button>}
      <Button type="button" variant="secondary" disabled={!metadata || !!error || preview.loading} onClick={() => void loadPreview()}>{preview.loading ? "Preparing preview…" : selection ? "Load selection preview" : "Load preview"}</Button>
      <Button type="button" variant="secondary" disabled={!preview.range || !!preview.error} onClick={() => void controller.toggle()}>{preview.playing ? "Stop" : "Play"}</Button>
      <Button type="button" variant="secondary" disabled={!metadata} onClick={resetView}>Fit all</Button>
      {selection && <Button type="button" variant="secondary" onClick={() => setSelection(null)}>Clear selection</Button>}
    </div>
    {metadata && <p className="waveform-readout">Frame {playhead} · {(playhead / metadata.sampleRate).toFixed(3)}s{selection && ` · Selection [${selection.startFrame}, ${selection.endFrameExclusive}) · ${((selection.endFrameExclusive - selection.startFrame) / metadata.sampleRate).toFixed(3)}s`}</p>}
    {preview.range && <p className="waveform-preview-notice">Preview [{preview.range.startFrame}, {preview.range.endFrameExclusive}){preview.truncated ? ` · Limited to ${preview.truncationReason === "byteLimit" ? "32 MiB" : "60 seconds"}` : ""}</p>}
    {(error || preview.error) && <p className="waveform-preview-error" role="alert">{error ?? preview.error}</p>}
    <p id={helpId} className="waveform-preview-notice">Wheel: zoom · Shift + wheel / Alt + drag: pan · Drag: select · Double click / F: fit · Space: play / stop · Arrows: move one frame · Esc: clear</p>
  </section>;
}
