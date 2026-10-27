import { useEffect, useRef, useState } from 'react';
import type { PatternCopyModeScope, PatternCopyPartMode, PatternCopyPreview, PatternCopyPreviewRequest, PatternCopyTrackMode, ProjectStructure, ProjectStructureApi, StructureBank } from '../../api/projectStructure';
import { useTranslate, type MessageKey, type TranslateFn } from '../../i18n';

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; preview: PatternCopyPreview }
  | { kind: 'blocked'; preview: PatternCopyPreview }
  | { kind: 'error' };

const BLOCKERS = [
  'unsupportedScope',
  'crossProjectNotSupported',
  'multiPairNotSupported',
  'moveOrSwapNotSupported',
  'partBodyCopyRequested',
  'crossRoleCopySemanticsUnknown',
  'workingSavedCheckpointRuleUnresolved',
  'sourceEqualsDestinationPattern',
  'invalidTrackSelection',
  'specificTracksRequired',
  'trackIndicesOutOfRange',
  'sourceDocumentUnavailable',
  'destinationDocumentUnavailable',
  'documentMalformed',
  'documentUnsupportedVersion',
  'unresolvedSampleReference',
  'masterTrackSettingUnavailable',
  'documentChangedDuringRead',
] as const;

const BLOCKER_KEYS: Record<(typeof BLOCKERS)[number], MessageKey> = {
  unsupportedScope: 'pse.preview.blocker.unsupportedScope',
  crossProjectNotSupported: 'pse.preview.blocker.crossProjectNotSupported',
  multiPairNotSupported: 'pse.preview.blocker.multiPairNotSupported',
  moveOrSwapNotSupported: 'pse.preview.blocker.moveOrSwapNotSupported',
  partBodyCopyRequested: 'pse.preview.blocker.partBodyCopyRequested',
  crossRoleCopySemanticsUnknown: 'pse.preview.blocker.crossRoleCopySemanticsUnknown',
  workingSavedCheckpointRuleUnresolved: 'pse.preview.blocker.workingSavedCheckpointRuleUnresolved',
  sourceEqualsDestinationPattern: 'pse.preview.blocker.sourceEqualsDestinationPattern',
  invalidTrackSelection: 'pse.preview.blocker.invalidTrackSelection',
  specificTracksRequired: 'pse.preview.blocker.specificTracksRequired',
  trackIndicesOutOfRange: 'pse.preview.blocker.trackIndicesOutOfRange',
  sourceDocumentUnavailable: 'pse.preview.blocker.sourceDocumentUnavailable',
  destinationDocumentUnavailable: 'pse.preview.blocker.destinationDocumentUnavailable',
  documentMalformed: 'pse.preview.blocker.documentMalformed',
  documentUnsupportedVersion: 'pse.preview.blocker.documentUnsupportedVersion',
  unresolvedSampleReference: 'pse.preview.blocker.unresolvedSampleReference',
  masterTrackSettingUnavailable: 'pse.preview.blocker.masterTrackSettingUnavailable',
  documentChangedDuringRead: 'pse.preview.blocker.documentChangedDuringRead',
};

function bankKey(bank: StructureBank): string {
  return `${bank.role}:${bank.index}`;
}
function selectable(bank: StructureBank): boolean {
  return bank.role === 'working' && bank.parseStatus === 'parsed';
}
function patternLabel(letter: string, index: number): string {
  return `${letter}${String(index + 1).padStart(2, '0')}`;
}
function trackLabel(track: number, t: TranslateFn): string {
  return track < 8
    ? `${t('pse.preview.scopeAudio')} ${track + 1}`
    : `${t('pse.preview.scopeMidi')} ${track - 7}`;
}
function observationLabel(observation: { compared: boolean; differs: boolean }, t: TranslateFn): string {
  if (!observation.compared) return t('pse.preview.notCompared');
  return observation.differs ? t('pse.preview.comparedDiffers') : t('pse.preview.comparedSame');
}
function preservedLabel(field: string, t: TranslateFn): string {
  if (field === 'destination_part_bodies') return t('pse.preview.partBodies');
  if (field === 'destination_part_assignment') return t('pse.preview.keepOriginal');
  if (field === 'destination_audio_track_trigs') return t('pse.preview.scopeAudio');
  if (field === 'destination_midi_track_trigs') return t('pse.preview.scopeMidi');
  return field;
}
function blockerLabel(code: string, t: TranslateFn): string {
  if (code in BLOCKER_KEYS) return t(BLOCKER_KEYS[code as keyof typeof BLOCKER_KEYS]);
  return `${t('pse.preview.blocker.unknown')} (${code})`;
}

export function PatternCopyPreviewPanel({ rootId, projectRelativePath, structure, client }: {
  rootId: string;
  projectRelativePath: string;
  structure: ProjectStructure;
  client: ProjectStructureApi;
}) {
  const t = useTranslate();
  const generation = useRef(0);
  const mounted = useRef(true);
  const [sourceKey, setSourceKey] = useState('');
  const [sourcePattern, setSourcePattern] = useState(0);
  const [destinationKey, setDestinationKey] = useState('');
  const [destinationPattern, setDestinationPattern] = useState(0);
  const [trackMode, setTrackMode] = useState<PatternCopyTrackMode>('all');
  const [modeScope, setModeScope] = useState<PatternCopyModeScope>('both');
  const [partMode, setPartMode] = useState<PatternCopyPartMode>('keepOriginal');
  const [specificPart, setSpecificPart] = useState(0);
  const [specificTracks, setSpecificTracks] = useState<number[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function invalidate() {
    generation.current += 1;
    setPhase({ kind: 'idle' });
  }

  useEffect(() => {
    const first = structure.banks.find(selectable);
    invalidate();
    if (!first) {
      setSourceKey('');
      setDestinationKey('');
      return;
    }
    const nextPattern = first.patterns[1]?.index ?? first.patterns[0]?.index ?? 0;
    setSourceKey(bankKey(first));
    setDestinationKey(bankKey(first));
    setSourcePattern(first.patterns[0]?.index ?? 0);
    setDestinationPattern(nextPattern);
  }, [structure, rootId, projectRelativePath]);

  const source = structure.banks.find(bank => bankKey(bank) === sourceKey);
  const destination = structure.banks.find(bank => bankKey(bank) === destinationKey);
  const canCalculate = source !== undefined && destination !== undefined && selectable(source) && selectable(destination) && phase.kind !== 'loading';

  function toggleTrack(track: number) {
    invalidate();
    setSpecificTracks(current => current.includes(track) ? current.filter(item => item !== track) : [...current, track].sort((a, b) => a - b));
  }

  function calculate() {
    if (!source || !destination || !selectable(source) || !selectable(destination) || !client.previewPatternCopy) {
      setPhase({ kind: 'error' });
      return;
    }
    const request: PatternCopyPreviewRequest = {
      rootId,
      projectRelativePath,
      sourceBank: source.index,
      sourcePattern,
      destinationBank: destination.index,
      destinationPattern,
      sourceRole: 'working',
      destinationRole: 'working',
      trackMode,
      modeScope,
      specificTracks: trackMode === 'specific' ? specificTracks : [],
      partAssignmentMode: partMode,
      specificPart: partMode === 'selectSpecific' ? specificPart : null,
    };
    const token = generation.current + 1;
    generation.current = token;
    setPhase({ kind: 'loading' });
    client.previewPatternCopy(request).then(preview => {
      if (!mounted.current || generation.current !== token) return;
      if (preview.sampleReferences.some(reference => reference.confirmedOnMedia) || preview.applyAuthorized !== false) {
        setPhase({ kind: 'error' });
        return;
      }
      setPhase(preview.status === 'ready' ? { kind: 'ready', preview } : { kind: 'blocked', preview });
    }).catch(() => {
      if (!mounted.current || generation.current !== token) return;
      setPhase({ kind: 'error' });
    });
  }

  const preview = phase.kind === 'ready' || phase.kind === 'blocked' ? phase.preview : null;
  const inScope = preview?.tracks.filter(track => track.inCopyScope) ?? [];
  const changed = preview?.tracks.filter(track => track.contentDiffers) ?? [];
  return <section className="pse-preview" aria-label={t('pse.preview.heading')}>
    <h5>{t('pse.preview.heading')}</h5>
    <div className="pse-preview__grid">
      <fieldset>
        <legend>{t('pse.preview.source')}</legend>
        <label>{t('pse.preview.sourceBank')} <select aria-label={t('pse.preview.sourceBank')} value={sourceKey} onChange={event => { invalidate(); setSourceKey(event.target.value); setSourcePattern(0); }}>
          {structure.banks.map(bank => <option key={bankKey(bank)} value={bankKey(bank)} disabled={!selectable(bank)}>{bank.letter} · {t('pse.preview.workingRole')}{selectable(bank) ? '' : ` · ${t('pse.preview.unavailableBank')}`}</option>)}
        </select></label>
        <label>{t('pse.preview.sourcePattern')} <select aria-label={t('pse.preview.sourcePattern')} value={sourcePattern} onChange={event => { invalidate(); setSourcePattern(Number(event.target.value)); }}>
          {(source?.patterns ?? []).map(pattern => <option key={pattern.index} value={pattern.index}>{patternLabel(source?.letter ?? '?', pattern.index)}</option>)}
        </select></label>
        <p>{t('pse.preview.workingRole')}</p>
      </fieldset>
      <fieldset>
        <legend>{t('pse.preview.destination')}</legend>
        <label>{t('pse.preview.destinationBank')} <select aria-label={t('pse.preview.destinationBank')} value={destinationKey} onChange={event => { invalidate(); setDestinationKey(event.target.value); setDestinationPattern(0); }}>
          {structure.banks.map(bank => <option key={bankKey(bank)} value={bankKey(bank)} disabled={!selectable(bank)}>{bank.letter} · {t('pse.preview.workingRole')}{selectable(bank) ? '' : ` · ${t('pse.preview.unavailableBank')}`}</option>)}
        </select></label>
        <label>{t('pse.preview.destinationPattern')} <select aria-label={t('pse.preview.destinationPattern')} value={destinationPattern} onChange={event => { invalidate(); setDestinationPattern(Number(event.target.value)); }}>
          {(destination?.patterns ?? []).map(pattern => <option key={pattern.index} value={pattern.index}>{patternLabel(destination?.letter ?? '?', pattern.index)}</option>)}
        </select></label>
        <p>{t('pse.preview.workingRole')}</p>
      </fieldset>
      <fieldset>
        <legend>{t('pse.preview.target')}</legend>
        <label>{t('pse.preview.trackMode')} <select aria-label={t('pse.preview.trackMode')} value={trackMode} onChange={event => { invalidate(); setTrackMode(event.target.value as PatternCopyTrackMode); }}>
          <option value="all">{t('pse.preview.modeAll')}</option>
          <option value="specific">{t('pse.preview.modeSpecific')}</option>
        </select></label>
        <label>{t('pse.preview.scope')} <select aria-label={t('pse.preview.scope')} value={modeScope} onChange={event => { invalidate(); setModeScope(event.target.value as PatternCopyModeScope); }}>
          <option value="audio">{t('pse.preview.scopeAudio')}</option>
          <option value="midi">{t('pse.preview.scopeMidi')}</option>
          <option value="both">{t('pse.preview.scopeBoth')}</option>
        </select></label>
        <label>{t('pse.preview.partMode')} <select aria-label={t('pse.preview.partMode')} value={partMode} onChange={event => { invalidate(); setPartMode(event.target.value as PatternCopyPartMode); }}>
          <option value="keepOriginal">{t('pse.preview.keepOriginal')}</option>
          <option value="copySourcePartAssignment">{t('pse.preview.copySourceAssignment')}</option>
          <option value="selectSpecific">{t('pse.preview.selectSpecific')}</option>
        </select></label>
        <label>{t('pse.preview.part')} <select aria-label={t('pse.preview.part')} value={specificPart} disabled={partMode !== 'selectSpecific'} onChange={event => { invalidate(); setSpecificPart(Number(event.target.value)); }}>
          {[0, 1, 2, 3].map(part => <option key={part} value={part}>{part + 1}</option>)}
        </select></label>
        <div className="pse-preview__tracks">
          {Array.from({ length: 16 }, (_, track) => <label key={track}><input type="checkbox" disabled={trackMode !== 'specific'} checked={specificTracks.includes(track)} onChange={() => toggleTrack(track)} />{trackLabel(track, t)}</label>)}
        </div>
      </fieldset>
    </div>
    <button type="button" onClick={calculate} disabled={!canCalculate}>{t('pse.preview.calculate')}</button>
    {phase.kind === 'loading' ? <p role="status">{t('pse.preview.loading')}</p> : null}
    {phase.kind === 'error' ? <p role="alert">{t('pse.preview.error')}</p> : null}
    {phase.kind === 'idle' ? <p>{t('pse.preview.idle')}</p> : null}
    {preview ? <div>
      <p>{phase.kind === 'ready' ? t('pse.preview.ready') : t('pse.preview.blocked')}</p>
      <p>{t('pse.preview.noWrite')}</p>
      <p>{t('pse.preview.applyNo')}</p>
      <p>{patternLabel(source?.letter ?? '?', preview.sourcePattern)} → {patternLabel(destination?.letter ?? '?', preview.destinationPattern)}</p>
      <p>{t('pse.preview.inScope')}: {inScope.map(track => trackLabel(track.trackNumber, t)).join(', ') || t('pse.preview.notCompared')}</p>
      <p>{t('pse.preview.changedTracks')}: {changed.map(track => trackLabel(track.trackNumber, t)).join(', ') || t('pse.preview.noTrackDiff')}</p>
      <p>{observationLabel(preview.patternContent, t)}</p>
      <p>{t('pse.preview.partMode')}: {observationLabel(preview.partAssignment, t)}</p>
      <p>{t('pse.preview.partBodies')}</p>
      <p>{t('pse.preview.preserved')}: {preview.preservedDestinationFields.map(field => preservedLabel(field, t)).join(', ')}</p>
      <p>{t('pse.preview.samples')}</p>
      <p>{t('pse.preview.samplesNote')}</p>
      {preview.sampleReferences.some(reference => !reference.classified) || preview.blockers.includes('unresolvedSampleReference') ? <p>{t('pse.preview.unresolved')}</p> : null}
      <ul>{preview.sampleReferences.map((reference, index) => <li key={index}>{trackLabel(reference.trackNumber, t)}{reference.step === null ? '' : ` · ${reference.step + 1}`}{reference.classified ? '' : ` · ${t('pse.preview.unresolved')}`}</li>)}</ul>
      <p>{t('pse.preview.unmodeled')}: {preview.unmodeledDependencies.join(', ')}</p>
      {preview.blockers.length > 0 ? <ul>{preview.blockers.map(code => <li key={code}>{blockerLabel(code, t)}</li>)}</ul> : null}
    </div> : null}
  </section>;
}
