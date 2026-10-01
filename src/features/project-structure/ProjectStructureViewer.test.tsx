import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectStructure, StructureBank, SlotReference } from '../../api/projectStructure';
import type { SampleUsageEdge } from '../../api';
import { LocaleProvider } from '../../i18n';
import { ProjectStructureViewer } from './ProjectStructureViewer';
const slots: SlotReference[] = [ { kind: 'slot', slotKind: 'static', number: 3 }, { kind: 'slot', slotKind: 'flex', number: 128 }, { kind: 'recorderBuffer', bufferNumber: 2 }, { kind: 'unassigned' }, { kind: 'noSampleMachine' }, { kind: 'unrecognized', raw: 250 } ];
function bank(role: StructureBank['role'] = 'working'): StructureBank {
  return { index: 0, letter: 'A', role, sourceRelativePath: `SET/PROJECT/bank01.${role === 'working' ? 'work' : 'strd'}`, parseStatus: 'parsed', unmodeledDependencies: ['scenes', 'arrangements', 'recorderSetup'],
    patterns: [ { index: 0, partIndex: 0, scale: { kind: 'perTrack', masterLength: { kind: 'infinite' }, masterScale: { kind: 'times1' }, tracks: [{ track: 0, length: 12, scale: { kind: 'times1Over2' } }] } }, { index: 1, partIndex: 1, scale: { kind: 'normal', masterLength: 255, masterScale: { kind: 'times2' } } } ],
    parts: [{ index: 0, tracks: [...slots.map((slot, index) => ({ index, playback: { kind: 'audio' as const, machine: { kind: 'flex' as const }, slot } })), { index: 7, playback: { kind: 'master' } }] }, { index: 1, tracks: [{ index: 0, playback: { kind: 'audio', machine: { kind: 'thru' }, slot: { kind: 'noSampleMachine' } } }] }] };
}
const data: ProjectStructure = { schema: 'masterocta.project-structure:v3', projectRelativePath: 'SET/PROJECT', projectState: { role: 'working', sourceRelativePath: 'SET/PROJECT/project.work', parseStatus: 'parsed', bank: { kind: 'selected', index: 0 }, pattern: { kind: 'selected', index: 1 }, arrangement: { kind: 'unmapped', raw: 7 }, masterTrack: true }, banks: [bank(), bank('savedCheckpoint')] };
function view(read = vi.fn().mockResolvedValue(data), usageEdges: SampleUsageEdge[] = []) {
  return render(<LocaleProvider initialLocaleId="en"><ProjectStructureViewer rootId="root" projectRelativePath="SET/PROJECT" client={{ read }} usageEdges={usageEdges} /></LocaleProvider>);
}
describe('Project Structure Viewer', () => {
  it('traces Pattern to Part and Track; shows INF, per-track scale, Master and every slot variant', async () => {
    const read = vi.fn().mockResolvedValue(data);
    view(read);
    expect(screen.getByRole('status')).toHaveTextContent('Reading');
    await screen.findByRole('table');
    expect(read).toHaveBeenCalledWith('root', 'SET/PROJECT');
    expect(screen.getByText(/INF · 1×/)).toBeInTheDocument();
    expect(screen.getByText('12 · 1/2×')).toBeInTheDocument();
    for (const label of ['Static 3', 'Flex 128', 'Recorder 2', 'Unread / unknown (250)', 'Master']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(/Arrangement: Unmapped \(7\)/)).toBeInTheDocument();
    expect(screen.getByText('Scene: not read · Arranger: out of scope')).toBeInTheDocument();
    const masterRow = screen.getByText('Master').closest('tr')!;
    expect(within(masterRow).queryByText(/Flex|Static|Recorder/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: '1' } });
    expect(screen.getByText(/Pattern A02 → Part 2.*255 · 2×/)).toBeInTheDocument();
    expect(screen.queryByText('Master')).toBeNull();
    expect(screen.queryByRole('button', { name: /apply|copy|move|swap/i })).toBeNull();
  });
  it('keeps working and saved separate and withholds malformed/unsupported structures', async () => {
    for (const status of ['malformed', 'unsupportedVersion'] as const) {
      const saved = { ...bank('savedCheckpoint'), parseStatus: status };
      const rendered = view(vi.fn().mockResolvedValue({ ...data, banks: [bank(), saved] }));
      await screen.findByRole('table');
      fireEvent.change(screen.getByLabelText('Bank'), { target: { value: saved.sourceRelativePath } });
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.queryByLabelText('Pattern')).toBeNull();
      expect(screen.getByText(/Structure withheld/)).toBeInTheDocument();
      rendered.unmount();
    }
  });
  it('labels catalog missing and sample-lock evidence only for matching bank document and coordinates', async () => {
    const edge: SampleUsageEdge = { bankDocumentRelativePath: bank().sourceRelativePath, projectDocumentRelativePath: 'SET/PROJECT/project.work', slotKind: 'static', slotNumber: 3, usageKind: 'machine', trackIndex: 0, partIndex: 0, patternIndex: null, stepIndex: null, audible: true, referencedFileRelativePath: 'SET/AUDIO/missing.wav', referenceStatus: 'missing' };
    view(undefined, [edge, { ...edge, bankDocumentRelativePath: bank('savedCheckpoint').sourceRelativePath, referencedFileRelativePath: 'SAVED_ONLY.wav' }, { ...edge, usageKind: 'sample_lock', partIndex: null, patternIndex: 0, stepIndex: 2, referencedFileRelativePath: 'LOCK.wav' }, { ...edge, partIndex: 1, referencedFileRelativePath: 'OTHER_PART.wav' }]);
    await screen.findByRole('table');
    expect(screen.getByText('SET/AUDIO/missing.wav')).toBeInTheDocument();
    expect(screen.getByText(/Sample lock.*Step 3.*Missing/)).toBeInTheDocument();
    expect(screen.queryByText('SAVED_ONLY.wav')).toBeNull();
    expect(screen.queryByText('OTHER_PART.wav')).toBeNull();
  });
  it('shows empty banks and absent project state without inventing data', async () => {
    view(vi.fn().mockResolvedValue({ ...data, banks: [], projectState: null }));
    await screen.findByText('No Bank documents found.');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Project state: Unread / unknown')).toBeInTheDocument();
  });
  it('sanitizes errors and supports retry', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('/private/secret')).mockResolvedValue(data);
    view(read);
    await screen.findByRole('alert');
    expect(screen.queryByText(/private/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload structure' }));
    await screen.findByRole('table');
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('drops late results from the previous root/project and clears old structure immediately', async () => {
    let resolveOld!: (value: ProjectStructure) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise<ProjectStructure>(resolve => { resolveOld = resolve; })).mockResolvedValue({ ...data, projectRelativePath: 'NEW', banks: [] });
    const rendered = render(<ProjectStructureViewer rootId="root" projectRelativePath="SET/PROJECT" client={{ read }} />);
    rendered.rerender(<ProjectStructureViewer rootId="new-root" projectRelativePath="NEW" client={{ read }} />);
    await waitFor(() => expect(read).toHaveBeenCalledWith('new-root', 'NEW'));
    await act(async () => { resolveOld(data); });
    expect(screen.queryByRole('table')).toBeNull();
  });
  it('renders Japanese labels and state names', async () => {
    render(<LocaleProvider initialLocaleId="ja"><ProjectStructureViewer rootId="root" projectRelativePath="SET/PROJECT" client={{ read: vi.fn().mockResolvedValue(data) }} /></LocaleProvider>);
    await screen.findByRole('table');
    expect(screen.getByText('Scene：未読取 · Arranger：対象外')).toBeInTheDocument();
    expect(screen.getByText('読み取り専用')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'トラック' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'サンプルスロット参照' })).toBeInTheDocument();
    expect(screen.getByLabelText('バンク')).toBeInTheDocument();
    expect(screen.getByLabelText('パターン')).toBeInTheDocument();
    expect(screen.getByText('マスター')).toBeInTheDocument();
    expect(screen.getByText('レコーダー 2')).toBeInTheDocument();
    expect(screen.getByText('スタティック 3')).toBeInTheDocument();
    expect(screen.getByText(/パターン A01 → パート 1 · トラックごと/)).toBeInTheDocument();
    expect(screen.getByText(/アレンジメント: 未マッピング \(7\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/解析済み/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Sample Slot Reference')).toBeNull();
    expect(screen.queryByText('Master')).toBeNull();
    expect(screen.queryByText('Recorder 2')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Track' })).toBeNull();
  });
  it('withholds Track 8 when project state cannot establish the master track', async () => {
    const fallback = structuredClone(data);
    fallback.projectState = { ...data.projectState!, masterTrack: null };
    fallback.banks[0].parts[0].tracks = fallback.banks[0].parts[0].tracks.map(track => track.index === 7
      ? { index: 7, playback: { kind: 'audio', machine: { kind: 'pickup' }, slot: { kind: 'slot', slotKind: 'flex', number: 99 } } }
      : track);
    const rendered = view(vi.fn().mockResolvedValue(fallback));
    await screen.findByRole('table');
    const row = screen.getByRole('rowheader', { name: '8' }).closest('tr')!;
    expect(within(row).getAllByText('Unknown (project state unavailable)')).toHaveLength(2);
    expect(within(row).queryByText('Pickup')).toBeNull();
    expect(within(row).queryByText('Flex 99')).toBeNull();
    expect(within(row).queryByText('Master')).toBeNull();
    rendered.unmount();
    const absent = structuredClone(data);
    absent.projectState = null;
    view(vi.fn().mockResolvedValue(absent));
    await screen.findByRole('table');
    const absentRow = screen.getByRole('rowheader', { name: '8' }).closest('tr')!;
    expect(within(absentRow).queryByText('Master')).toBeNull();
    expect(within(absentRow).getAllByText('Unknown (project state unavailable)').length).toBeGreaterThan(0);
  });
  it('shows Track 8 audio only when the project state says it is not the master track', async () => {
    const off = structuredClone(data);
    off.projectState = { ...data.projectState!, masterTrack: false };
    off.banks[0].parts[0].tracks = off.banks[0].parts[0].tracks.map(track => track.index === 7
      ? { index: 7, playback: { kind: 'audio', machine: { kind: 'pickup' }, slot: { kind: 'slot', slotKind: 'flex', number: 99 } } }
      : track);
    view(vi.fn().mockResolvedValue(off));
    await screen.findByRole('table');
    const row = screen.getByRole('rowheader', { name: '8' }).closest('tr')!;
    expect(within(row).getByText('Pickup')).toBeInTheDocument();
    expect(within(row).getByText('Flex 99')).toBeInTheDocument();
  });
});
