import { describe, expect, it, vi } from 'vitest';
import { createProjectStructureApi, type ProjectStructure } from './projectStructure';
const empty: ProjectStructure = { schema: 'masterocta.project-structure:v4', projectRelativePath: 'SET/PROJECT', projectState: null, banks: [] };
describe('Project Structure IPC contract', () => {
  it('uses only the registered root and relative project with one read command', async () => {
    const request = vi.fn().mockResolvedValue(empty);
    const api = createProjectStructureApi({ request });
    expect(Object.keys(api)).toEqual(['read', 'previewPatternCopy']);
    expect(await api.read('opaque-root', 'SET/PROJECT')).toEqual(empty);
    expect(request.mock.calls).toEqual([['v2_project_structure_read', { rootId: 'opaque-root', projectRelativePath: 'SET/PROJECT' }]]);
  });
  it('calculates a pattern copy preview through the read-only command', async () => {
    const preview = {
      schema: 'masterocta.pattern-copy-preview:v1', status: 'ready', applyAuthorized: false, projectRelativePath: 'SET/PROJECT',
      sourceBank: 0, sourcePattern: 0, destinationBank: 0, destinationPattern: 1, sourceRole: 'working', destinationRole: 'working',
      trackMode: 'all', modeScope: 'both', partAssignmentMode: 'keepOriginal', observedDocumentDigest: null, tracks: [],
      patternContent: { compared: true, differs: false }, partAssignment: { compared: true, differs: false }, partContentIncluded: false,
      preservedDestinationFields: [], unmodeledDependencies: [], blockers: [],
      sampleReferences: [{ trackNumber: 0, step: null, origin: 'partMachine', slot: { kind: 'slot', slotKind: 'static', number: 1 }, summary: 'part_machine', classified: true, confirmedOnMedia: false }],
    };
    const request = vi.fn().mockResolvedValue(preview);
    const api = createProjectStructureApi({ request });
    const args = { rootId: 'opaque-root', projectRelativePath: 'SET/PROJECT', sourceBank: 0, sourcePattern: 0, destinationBank: 0, destinationPattern: 1, sourceRole: 'working' as const, destinationRole: 'working' as const, trackMode: 'all' as const, modeScope: 'both' as const, specificTracks: [], partAssignmentMode: 'keepOriginal' as const, specificPart: null };
    expect(api.previewPatternCopy).toBeTypeOf('function');
    expect(await api.previewPatternCopy?.(args)).toEqual(preview);
    expect(request.mock.calls).toEqual([['v2_pattern_copy_preview', args]]);
    const missingSlot = { ...preview, sampleReferences: [{ ...preview.sampleReferences[0], slot: undefined }] };
    await expect(createProjectStructureApi({ request: vi.fn().mockResolvedValue(missingSlot) }).previewPatternCopy?.(args)).rejects.toThrow('PATTERN_COPY_PREVIEW_CONTRACT_MISMATCH');
  });
  it.each([{ ...empty, schema: 'masterocta.project-structure:v2' }, { ...empty, projectRelativePath: 'OTHER' }])('rejects incompatible schema or wrong target', async result => {
    await expect(createProjectStructureApi({ request: vi.fn().mockResolvedValue(result) }).read('root', 'SET/PROJECT')).rejects.toThrow('CONTRACT_MISMATCH');
  });
});
