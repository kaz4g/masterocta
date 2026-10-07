import { useEffect, useState } from 'react';
import { projectStructureApi, type ProjectStructureApi, type ProjectStructure, type PatternScale, type PlaybackScale, type SlotReference, type Machine, type ParseStatus } from '../../api/projectStructure';
import type { SampleUsageEdge } from '../../api';
import { useTranslate, type TranslateFn } from '../../i18n';
import './ProjectStructureViewer.css';

interface Props {
  rootId: string;
  projectRelativePath: string;
  usageEdges?: SampleUsageEdge[];
  client?: ProjectStructureApi;
}
const scaleNames: Record<string, string> = { times2: '2×', times3Over2: '3/2×', times1: '1×', times3Over4: '3/4×', times1Over2: '1/2×', times1Over4: '1/4×', times1Over8: '1/8×' };
function playbackScale(scale: PlaybackScale, t: TranslateFn): string {
  return scale.kind === 'unrecognized' ? t('pse.unknownRaw', { raw: scale.raw }) : scaleNames[scale.kind] ?? t('pse.unknown');
}
function lengthScale(length: string | number, scale: string, t: TranslateFn): string {
  return t('pse.lengthScale', { length: String(length), scale });
}
function patternLength(scale: PatternScale, t: TranslateFn): string {
  if (scale.kind === 'unrecognized') return t('pse.unknownRaw', { raw: scale.raw });
  const length = scale.kind === 'normal' ? scale.masterLength
    : scale.masterLength.kind === 'finite' ? scale.masterLength.steps
    : scale.masterLength.kind === 'infinite' ? t('pse.infinite') : t('pse.unknown');
  return lengthScale(length, playbackScale(scale.masterScale, t), t);
}
function slotLabel(slot: SlotReference, t: TranslateFn): string {
  switch (slot.kind) {
    case 'slot': return t(slot.slotKind === 'static' ? 'pse.slotStatic' : 'pse.slotFlex', { number: slot.number });
    case 'recorderBuffer': return t('pse.recorder', { number: slot.bufferNumber });
    case 'unassigned': return t('pse.unassigned');
    case 'noSampleMachine': return t('pse.noSampleMachine');
    case 'unrecognized': return t('pse.unreadRaw', { raw: slot.raw });
  }
}
function machineLabel(machine: Machine, t: TranslateFn): string {
  switch (machine.kind) {
    case 'unknown': return t('pse.unreadRaw', { raw: machine.raw });
    case 'static': return t('pse.machineKind.static');
    case 'flex': return t('pse.machineKind.flex');
    case 'thru': return t('pse.machineKind.thru');
    case 'neighbor': return t('pse.machineKind.neighbor');
    case 'pickup': return t('pse.machineKind.pickup');
  }
}
function parseStatusLabel(status: ParseStatus, t: TranslateFn): string {
  switch (status) {
    case 'parsed': return t('pse.parseStatus.parsed');
    case 'unsupportedVersion': return t('pse.parseStatus.unsupportedVersion');
    case 'malformed': return t('pse.parseStatus.malformed');
  }
}
function scaleKindLabel(kind: PatternScale['kind'], t: TranslateFn): string {
  switch (kind) {
    case 'normal': return t('pse.scaleKind.normal');
    case 'perTrack': return t('pse.scaleKind.perTrack');
    case 'unrecognized': return t('pse.scaleKind.unrecognized');
  }
}
function patternId(letter: string, index: number): string {
  return `${letter}${String(index + 1).padStart(2, '0')}`;
}
function evidenceLabel(edge: SampleUsageEdge, t: TranslateFn): string {
  const usage = edge.usageKind === 'machine' ? t('pse.usage.machine') : t('pse.usage.sampleLock');
  const slot = t(edge.slotKind === 'static' ? 'pse.slotStatic' : 'pse.slotFlex', { number: edge.slotNumber });
  const status = edge.referenceStatus === 'resolved' ? t('pse.reference.resolved')
    : edge.referenceStatus === 'missing' ? t('pse.reference.missing')
    : edge.referenceStatus === 'invalid_path' ? t('pse.reference.invalidPath')
    : t('pse.reference.unassignedSlot');
  return edge.stepIndex === null
    ? t('pse.catalogEvidence', { usage, slot, status })
    : t('pse.catalogEvidenceStep', { usage, slot, step: edge.stepIndex + 1, status });
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
  const trackEightRoleUnknown = projectState?.masterTrack == null;
  return <section className="pse-viewer" aria-label={t('pse.title')}>
    <header><h4>{t('pse.title')}</h4><span>{t('pse.readOnly')}</span>
      <button type="button" onClick={() => setReload(n => n + 1)}>{t('pse.reload')}</button></header>
    <p>{t('pse.deferred')}</p>
    {error ? <p role="alert">{t('pse.error')}</p> : data === null ? <p role="status">{t('pse.loading')}</p> : <>
      <p>{t('pse.projectState')}: {projectState ? parseStatusLabel(projectState.parseStatus, t) : t('pse.unread')}
        {projectState?.parseStatus === 'parsed' && <>
          {' · '}{t('pse.stateBank', { bank: projectState.bank?.kind === 'selected' ? String.fromCharCode(65 + projectState.bank.index) : t('pse.unread') })}
          {' · '}{t('pse.statePattern', { pattern: projectState.pattern?.kind === 'selected' ? String(projectState.pattern.index + 1) : t('pse.unread') })}
          {' · '}{projectState.arrangement?.kind === 'selected' ? t('pse.stateArrangement', { arrangement: String(projectState.arrangement.index + 1) }) : projectState.arrangement?.kind === 'unrecognized' ? t('pse.arrangementUnrecognized', { raw: projectState.arrangement.raw }) : t('pse.unread')}
        </>}
      </p>
      {bank === undefined ? <p>{t('pse.noBanks')}</p> : <>
        <label>{t('pse.bank')} <select aria-label={t('pse.bank')} value={bank.sourceRelativePath} onChange={e => { setBankKey(e.target.value); setPatternIndex(0); }}>
          {data.banks.map(b => <option key={b.sourceRelativePath} value={b.sourceRelativePath}>{b.letter} · {t(b.role === 'working' ? 'pse.working' : 'pse.saved')} · {parseStatusLabel(b.parseStatus, t)}</option>)}
        </select></label>
        <p><code>{bank.sourceRelativePath}</code> · {parseStatusLabel(bank.parseStatus, t)}</p>
        {!parsed ? <p>{t('pse.unavailable')}</p> : pattern === undefined ? <p>{t('pse.noPatterns')}</p> : <>
          <label>{t('pse.pattern')} <select aria-label={t('pse.pattern')} value={pattern.index} onChange={e => setPatternIndex(Number(e.target.value))}>
            {bank.patterns.map(p => <option key={p.index} value={p.index}>{t('pse.patternChoice', { id: patternId(bank.letter, p.index), part: p.partIndex + 1 })}</option>)}
          </select></label>
          <p>{t('pse.patternSummary', { id: patternId(bank.letter, pattern.index), part: pattern.partIndex + 1, mode: scaleKindLabel(pattern.scale.kind, t), length: patternLength(pattern.scale, t) })}</p>
          {part === undefined ? <p>{t('pse.unavailable')}</p> : <div className="pse-viewer__table"><table>
            <thead><tr><th>{t('pse.track')}</th><th>{t('pse.machine')}</th><th>{t('pse.slotReference')}</th><th>{t('pse.scale')}</th><th>{t('pse.references')}</th></tr></thead>
            <tbody>{part.tracks.map(track => {
              const roleUnknown = track.index === 7 && trackEightRoleUnknown;
              const audio = roleUnknown || track.playback.kind !== 'audio' ? null : track.playback;
              const scale = pattern.scale.kind === 'perTrack' ? pattern.scale.tracks.find(s => s.track === track.index) : null;
              // Catalog evidence is a separate snapshot: retain source/role and usage coordinates.
              const edges = audio === null ? [] : usageEdges.filter(edge => edge.bankDocumentRelativePath === bank.sourceRelativePath && edge.trackIndex === track.index &&
                ((edge.usageKind === 'machine' && edge.partIndex === part.index) || (edge.usageKind === 'sample_lock' && edge.patternIndex === pattern.index)));
              return <tr key={track.index}><th scope="row">{track.index + 1}</th>
                <td>{roleUnknown ? t('pse.trackEightUnknown') : audio === null ? t('pse.master') : machineLabel(audio.machine, t)}</td>
                <td>{roleUnknown ? t('pse.trackEightUnknown') : audio === null ? '—' : slotLabel(audio.slot, t)}</td>
                <td>{scale ? lengthScale(scale.length, playbackScale(scale.scale, t), t) : pattern.scale.kind === 'normal' ? patternLength(pattern.scale, t) : t('pse.unread')}</td>
                <td>{edges.length === 0 ? t('pse.noCatalogEvidence') : <ul>{edges.map((edge, i) => <li key={i}>{evidenceLabel(edge, t)}{edge.referencedFileRelativePath ? <> · <code>{edge.referencedFileRelativePath}</code></> : null}</li>)}</ul>}</td>
              </tr>;
            })}</tbody></table></div>}
        </>}
      </>}
    </>}
  </section>;
}
