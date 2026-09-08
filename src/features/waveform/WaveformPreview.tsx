import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { audioApi, type AudioApi, type AudioFrameRange, type AudioWaveformWindow } from '../../api';
import { Button } from '../../design-system';
import { boundedRange, formatFrameTime, fractionAtFrame, frame, frameAtFraction, panRange, peakPath, rangeLength, validateRange, validateWaveform, zoomRange } from './frameMath';
import './WaveformPreview.css';

interface WaveformPreviewProps { rootId: string; assetId: string; displayName: string; api?: AudioApi; }
type ChannelView = 'split' | 'overlay' | 'left' | 'right';
function message(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : 'Audio could not be loaded.';
}

/** Identity-keyed state prevents even a one-render flash of the previous asset. */
export function WaveformPreview(props: WaveformPreviewProps) {
  return <WaveformSession key={`${props.rootId}:${props.assetId}`} {...props} />;
}

function WaveformSession({ rootId, assetId, displayName, api = audioApi }: WaveformPreviewProps) {
  const container = useRef<HTMLDivElement>(null);
  const [targetPoints, setTargetPoints] = useState(800);
  const [viewport, setViewport] = useState<AudioFrameRange | null>(null);
  const [waveform, setWaveform] = useState<AudioWaveformWindow | null>(null);
  const [overview, setOverview] = useState<AudioWaveformWindow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<AudioFrameRange | null>(null);
  const [startInput, setStartInput] = useState('0');
  const [endInput, setEndInput] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [channelView, setChannelView] = useState<ChannelView>('split');
  const anchor = useRef<bigint | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewRange, setPreviewRange] = useState<AudioFrameRange | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState<bigint | null>(null);
  const previewRequest = useRef(0);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !container.current) return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width > 0) setTargetPoints(Math.max(32, Math.min(4096, Math.ceil(width * Math.min(window.devicePixelRatio || 1, 2)))));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      api.queryWaveform(rootId, assetId, { range: viewport, targetPoints }).then(result => {
        if (!active) return;
        const next = validateWaveform(result, targetPoints);
        if (viewport && (next.range.startFrame !== viewport.startFrame || next.range.endFrame !== viewport.endFrame)) {
          throw new Error('Waveform response does not match the requested range.');
        }
        setWaveform(next);
        if (viewport === null) setOverview(next);
      }).catch(reason => { if (active) setError(message(reason)); })
        .finally(() => { if (active) setLoading(false); });
    }, 100);
    return () => { active = false; clearTimeout(timer); };
  }, [api, assetId, rootId, viewport, targetPoints]);

  useEffect(() => () => { previewRequest.current += 1; }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const view = waveform?.range;
  const duration = waveform ? formatFrameTime(waveform.frameCount, waveform.sampleRate) : null;
  const audition = selection ?? view;
  const canPreview = waveform && audition && rangeLength(audition) <= BigInt(waveform.sampleRate) * 30n
    && rangeLength(audition) * BigInt(waveform.channels * 2) <= 16n * 1024n * 1024n;
  const fullView = view && waveform && view.startFrame === '0' && view.endFrame === waveform.frameCount;

  useEffect(() => {
    // A completed preview must still belong to the range currently being auditioned.
    previewRequest.current += 1;
    setPreviewUrl(null);
    setPreviewRange(null);
    setPlayhead(null);
    setPreviewing(false);
    setPreviewError(null);
  }, [audition?.startFrame, audition?.endFrame]);

  function selectRange(next: AudioFrameRange | null) {
    setSelection(next);
    setStartInput(next?.startFrame ?? '0');
    setEndInput(next?.endFrame ?? '');
    setRangeError(null);
  }
  function applyRange() {
    if (!waveform) return;
    try { selectRange(validateRange({ startFrame: startInput, endFrame: endInput }, waveform.frameCount)); }
    catch (reason) { setRangeError(message(reason)); }
  }
  function pointerFrame(event: PointerEvent<SVGSVGElement>): bigint {
    const rect = event.currentTarget.getBoundingClientRect();
    return frameAtFraction(view!, rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0);
  }
  function updateDrag(event: PointerEvent<SVGSVGElement>) {
    if (anchor.current === null || !view || !waveform) return;
    const next = pointerFrame(event), first = anchor.current;
    const left = next < first ? next : first, right = next > first ? next : first;
    selectRange(boundedRange(left, right - left || 1n, frame(waveform.frameCount)));
  }
  async function loadPreview() {
    if (!canPreview || !audition) return;
    const request = ++previewRequest.current;
    const selected = audition;
    setPreviewing(true); setPreviewError(null); setPreviewUrl(null); setPlayhead(null);
    try {
      const ticket = await api.createRangePreviewToken(rootId, assetId, selected);
      if (previewRequest.current !== request) return;
      const bytes = await api.readPreview(rootId, ticket.previewToken);
      if (previewRequest.current !== request) return;
      const buffer = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
      if (ticket.mimeType !== 'audio/wav' || buffer.byteLength !== ticket.byteLength || ticket.truncated) {
        throw new Error('Preview response failed validation.');
      }
      setPreviewUrl(URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' })));
      setPreviewRange(selected);
    } catch (reason) { if (previewRequest.current === request) setPreviewError(message(reason)); }
    finally { if (previewRequest.current === request) setPreviewing(false); }
  }
  const channels = waveform ? (channelView === 'left' ? [0] : channelView === 'right' ? [1] : waveform.channelPeaks.map((_, i) => i)) : [];
  const plotHeight = channelView === 'split' ? channels.length * 100 : 100;
  const selectionStart = selection && view ? Math.max(0, fractionAtFrame(frame(selection.startFrame), view)) : 0;
  const selectionEnd = selection && view ? Math.min(1, fractionAtFrame(frame(selection.endFrame), view)) : 0;
  const cursor = playhead !== null && view ? fractionAtFrame(playhead, view) : -1;

  return (
    <section className="waveform-preview" aria-label={`Waveform preview for ${displayName}`}>
      <div className="waveform-preview-heading"><p>Waveform 2.0</p><span>{duration}</span></div>
      <div className="waveform-toolbar" aria-label="Waveform controls">
        <Button variant="secondary" disabled={!view || loading || rangeLength(view) <= 1n} onClick={() => setViewport(zoomRange(view!, waveform!.frameCount, 'in', selection))}>Zoom in</Button>
        <Button variant="secondary" disabled={!view || loading || !!fullView} onClick={() => setViewport(zoomRange(view!, waveform!.frameCount, 'out', selection))}>Zoom out</Button>
        <Button variant="secondary" disabled={!view || loading || !!fullView} onClick={() => setViewport(null)}>Fit</Button>
        <Button variant="secondary" disabled={!selection || loading} onClick={() => setViewport(selection)}>Zoom selection</Button>
        <label>Display channels<select aria-label="Waveform channels" value={channelView} onChange={event => setChannelView(event.target.value as ChannelView)}>
          <option value="split">{waveform?.channels === 1 ? 'Mono' : 'Stereo · split'}</option>
          {waveform?.channels === 2 && <><option value="overlay">Stereo · overlay</option><option value="left">Left</option><option value="right">Right</option></>}
        </select></label>
      </div>
      <div ref={container} className="waveform-canvas" aria-busy={loading}>
        {waveform && view && <svg className="waveform-preview-plot" role="img" aria-label="Audio waveform" viewBox={`0 0 1000 ${plotHeight}`} preserveAspectRatio="none"
          onPointerDown={event => { if (loading || event.button !== 0) return; anchor.current = pointerFrame(event); event.currentTarget.setPointerCapture?.(event.pointerId); updateDrag(event); }}
          onPointerMove={updateDrag} onPointerUp={event => { updateDrag(event); anchor.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId); }}
          onPointerCancel={() => { anchor.current = null; }}>
          {channels.map((channel, index) => <g key={channel} transform={`translate(0,${channelView === 'split' ? index * 100 : 0})`}>
            <line x1="0" x2="1000" y1="50" y2="50" className="waveform-center" />
            <path data-channel={channel} className={`waveform-channel waveform-channel-${channel}`} d={peakPath(waveform.channelPeaks[channel], view, waveform.framesPerPeak)} />
            <text x={channelView === 'overlay' ? 8 + index * 50 : 8} y="16" className="waveform-channel-label">{waveform.channels === 1 ? 'MONO' : channel === 0 ? 'L' : 'R'}</text>
          </g>)}
          {selectionEnd > selectionStart && <rect className="waveform-selection" x={selectionStart * 1000} y="0" width={(selectionEnd - selectionStart) * 1000} height={plotHeight} />}
          {cursor >= 0 && cursor <= 1 && <line className="waveform-playhead" x1={cursor * 1000} x2={cursor * 1000} y1="0" y2={plotHeight} />}
        </svg>}
        {loading && <p className="waveform-preview-status" role="status">{waveform ? 'Loading detail…' : 'Generating waveform…'}</p>}
      </div>
      {view && waveform && <>
        <div className="waveform-time-ruler"><span>{formatFrameTime(view.startFrame, waveform.sampleRate)}</span><span>{formatFrameTime(view.endFrame, waveform.sampleRate)}</span></div>
        {overview && <div className="waveform-overview">
          <svg aria-label="Full audio overview" role="img" viewBox="0 0 1000 100" preserveAspectRatio="none">
            <path className="waveform-channel waveform-channel-0" d={peakPath(overview.channelPeaks[0], overview.range, overview.framesPerPeak)} />
            <rect className="waveform-viewport" x={fractionAtFrame(frame(view.startFrame), overview.range) * 1000} y="0" width={Number(rangeLength(view) * 1_000_000n / frame(waveform.frameCount)) / 1000} height="100" />
          </svg>
        </div>}
        <div className="waveform-pan">
          <Button variant="secondary" aria-label="Pan waveform left" disabled={loading || view.startFrame === '0'} onClick={() => setViewport(panRange(view, waveform.frameCount, -1))}>←</Button>
          <input type="range" aria-label="Waveform position" min="0" max="10000" step="1" disabled={loading || !!fullView}
            value={fullView ? 0 : Number(frame(view.startFrame) * 10000n / (frame(waveform.frameCount) - rangeLength(view)))}
            onChange={event => setViewport(boundedRange((frame(waveform.frameCount) - rangeLength(view)) * BigInt(event.target.value) / 10000n, rangeLength(view), frame(waveform.frameCount)))} />
          <Button variant="secondary" aria-label="Pan waveform right" disabled={loading || view.endFrame === waveform.frameCount} onClick={() => setViewport(panRange(view, waveform.frameCount, 1))}>→</Button>
        </div>
        <p className="waveform-detail-meta">{waveform.sampleRate.toLocaleString()} Hz · {waveform.channels === 1 ? 'Mono' : 'Stereo'} · {waveform.framesPerPeak} frames / peak</p>
        <fieldset className="waveform-range"><legend>Selection · source frames</legend>
          <label>Start<input aria-label="Selection start frame" inputMode="numeric" value={startInput} onChange={event => setStartInput(event.target.value)} /></label>
          <label>End (exclusive)<input aria-label="Selection end frame" inputMode="numeric" value={endInput} onChange={event => setEndInput(event.target.value)} /></label>
          <Button variant="secondary" onClick={applyRange}>Set range</Button>
          <Button variant="secondary" disabled={!selection} onClick={() => selectRange(null)}>Clear</Button>
        </fieldset>
        {selection && <p className="waveform-selection-label">Selected {formatFrameTime(selection.startFrame, waveform.sampleRate)}–{formatFrameTime(selection.endFrame, waveform.sampleRate)}</p>}
      </>}
      {rangeError && <p role="alert" className="waveform-preview-error">{rangeError}</p>}
      {error && <p role="alert" className="waveform-preview-error">{error}</p>}
      <div className="waveform-preview-actions"><Button variant="secondary" disabled={previewing || !canPreview || loading || error !== null} onClick={loadPreview}>{previewing ? 'Preparing preview…' : 'Load preview'}</Button></div>
      {waveform && !canPreview && <p className="waveform-preview-notice">Select or zoom to a range of up to 30 seconds (16 MiB) to preview it.</p>}
      {previewUrl && <audio aria-label={`Preview ${displayName}`} controls preload="metadata" src={previewUrl}
        onTimeUpdate={event => { if (previewRange && waveform) setPlayhead(frame(previewRange.startFrame) + BigInt(Math.floor(event.currentTarget.currentTime * waveform.sampleRate))); }} />}
      {previewError && <p role="alert" className="waveform-preview-error">{previewError}</p>}
      <p className="waveform-preview-boundary">Drag to select. Zoom and selection leave the original audio unchanged.</p>
    </section>
  );
}
