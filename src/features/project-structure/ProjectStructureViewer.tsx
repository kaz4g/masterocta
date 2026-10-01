import { useEffect, useState } from 'react';
import { projectStructureApi, type ProjectStructureApi, type ProjectStructure, type PatternScale, type PlaybackScale, type SlotReference } from '../../api/projectStructure';
import type { SampleUsageEdge } from '../../api';
import { useTranslate } from '../../i18n';
import './ProjectStructureViewer.css';

interface Props {
  rootId: string;
  projectRelativePath: string;
  usageEdges?: SampleUsageEdge[];
  client?: ProjectStructureApi;
}
const scaleNames: Record<string, string> = { times2: '2×', times3Over2: '3/2×', times1: '1×', times3Over4: '3/4×', times1Over2: '1/2×', times1Over4: '1/4×', times1Over8: '1/8×' };
function playbackScale(scale: PlaybackScale): string {
  return scale.kind === 'unrecognized' ? `Unknown (${scale.raw})` : scaleNames[scale.kind];
}
function patternLength(scale: PatternScale): string {
  if (scale.kind === 'unrecognized') return `Unknown (${scale.raw})`;
  const length = scale.kind === 'normal' ? scale.masterLength
    : scale.masterLength.kind === 'finite' ? scale.masterLength.steps
    : scale.masterLength.kind === 'infinite' ? 'INF' : 'Unknown';
  return `${length} · ${playbackScale(scale.masterScale)}`;
}
function slotLabel(slot: SlotReference, unread: string, unassigned: string, noSample: string): string {
  switch (slot.kind) {
    case 'slot': return `${slot.slotKind === 'static' ? 'Static' : 'Flex'} ${slot.number}`;
    case 'recorderBuffer': return `Recorder ${slot.bufferNumber}`;
    case 'unassigned': return unassigned;
    case 'noSampleMachine': return noSample;
    case 'unrecognized': return `${unread} (${slot.raw})`;
  }
}

/** Remount on root/project change so old structure is never rendered for a new target. */
export function ProjectStructureViewer(props: Props) {
  return <ViewerSession key={`${props.rootId}:${props.projectRelativePath}`} {...props} />;
}
function ViewerSession({ rootId, projectRelativePath, usageEdges = [], client = projectStructureApi }: Props) {
  const t = useTranslate();
  const [data, setData] = useState<ProjectStructure | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [bankKey, setBankKey] = useState('');
  const [patternIndex, setPatternIndex] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(false);
    client.read(rootId, projectRelativePath).then(result => {
      if (!active) return;
      setData(result);
      setBankKey('');
      setPatternIndex(0);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [client, rootId, projectRelativePath, reload]);
  const bank = data?.banks.find(b => b.sourceRelativePath === bankKey) ?? data?.banks[0];
  const parsed = bank?.parseStatus === 'parsed';
  const pattern = parsed ? bank.patterns.find(p => p.index === patternIndex) ?? bank.patterns[0] : undefined;
  const part = parsed && pattern ? bank.parts.find(p => p.index === pattern.partIndex) : undefined;
  const projectState = data?.projectState;
  return <section className="pse-viewer" aria-label={t('pse.title')}>
    <header><h4>{t('pse.title')}</h4><span>{t('pse.readOnly')}</span>
      <button type="button" onClick={() => setReload(n => n + 1)}>{t('pse.reload')}</button></header>
    <p>{t('pse.deferred')}</p>
    {error ? <p role="alert">{t('pse.error')}</p> : data === null ? <p role="status">{t('pse.loading')}</p> : <>
      <p>{t('pse.projectState')}: {projectState?.parseStatus ?? t('pse.unread')}
        {projectState?.parseStatus === 'parsed' && <>
          {' · Bank '}{projectState.bank?.kind === 'selected' ? String.fromCharCode(65 + projectState.bank.index) : t('pse.unread')}
          {' · Pattern '}{projectState.pattern?.kind === 'selected' ? projectState.pattern.index + 1 : t('pse.unread')}
          {' · Arrangement: Unmapped'}
          {projectState.arrangement?.kind === 'unmapped' ? ` (${projectState.arrangement.raw})` : ''}
        </>}
      </p>
      {bank === undefined ? <p>{t('pse.noBanks')}</p> : <>
        <label>Bank <select aria-label="Bank" value={bank.sourceRelativePath} onChange={e => { setBankKey(e.target.value); setPatternIndex(0); }}>
          {data.banks.map(b => <option key={b.sourceRelativePath} value={b.sourceRelativePath}>{b.letter} · {t(b.role === 'working' ? 'pse.working' : 'pse.saved')} · {b.parseStatus}</option>)}
        </select></label>
        <p><code>{bank.sourceRelativePath}</code> · {bank.parseStatus}</p>
        {!parsed ? <p>{t('pse.unavailable')}</p> : pattern === undefined ? <p>{t('pse.noPatterns')}</p> : <>
          <label>Pattern <select aria-label="Pattern" value={pattern.index} onChange={e => setPatternIndex(Number(e.target.value))}>
            {bank.patterns.map(p => <option key={p.index} value={p.index}>{bank.letter}{String(p.index + 1).padStart(2, '0')} → Part {p.partIndex + 1}</option>)}
          </select></label>
          <p>Pattern {bank.letter}{String(pattern.index + 1).padStart(2, '0')} → Part {pattern.partIndex + 1} · {pattern.scale.kind} · {patternLength(pattern.scale)}</p>
          {part === undefined ? <p>{t('pse.unavailable')}</p> : <div className="pse-viewer__table"><table>
            <thead><tr><th>Track</th><th>{t('pse.machine')}</th><th>Sample Slot Reference</th><th>{t('pse.scale')}</th><th>{t('pse.references')}</th></tr></thead>
            <tbody>{part.tracks.map(track => {
              const audio = track.playback.kind === 'audio' ? track.playback : null;
              const scale = pattern.scale.kind === 'perTrack' ? pattern.scale.tracks.find(s => s.track === track.index) : null;
              // Catalog evidence is a separate snapshot: retain source/role and usage coordinates.
              const edges = audio === null ? [] : usageEdges.filter(edge => edge.bankDocumentRelativePath === bank.sourceRelativePath && edge.trackIndex === track.index &&
                ((edge.usageKind === 'machine' && edge.partIndex === part.index) || (edge.usageKind === 'sample_lock' && edge.patternIndex === pattern.index)));
              return <tr key={track.index}><th scope="row">{track.index + 1}</th>
                <td>{audio === null ? 'Master' : audio.machine.kind === 'unknown' ? `${t('pse.unread')} (${audio.machine.raw})` : audio.machine.kind}</td>
                <td>{audio === null ? '—' : slotLabel(audio.slot, t('pse.unread'), t('pse.unassigned'), t('pse.noSampleMachine'))}</td>
                <td>{scale ? `${scale.length} · ${playbackScale(scale.scale)}` : pattern.scale.kind === 'normal' ? patternLength(pattern.scale) : t('pse.unread')}</td>
                <td>{edges.length === 0 ? t('pse.noCatalogEvidence') : <ul>{edges.map((edge, i) => <li key={i}>{edge.usageKind} · {edge.slotKind} {edge.slotNumber}{edge.stepIndex === null ? '' : ` · Step ${edge.stepIndex + 1}`} · {edge.referenceStatus}{edge.referencedFileRelativePath ? <> · <code>{edge.referencedFileRelativePath}</code></> : null}</li>)}</ul>}</td>
              </tr>;
            })}</tbody></table></div>}
        </>}
      </>}
    </>}
  </section>;
}
