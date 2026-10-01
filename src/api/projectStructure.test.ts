import { describe, expect, it, vi } from 'vitest';
import { createProjectStructureApi, type ProjectStructure } from './projectStructure';
const empty: ProjectStructure = { schema: 'masterocta.project-structure:v3', projectRelativePath: 'SET/PROJECT', projectState: null, banks: [] };
describe('Project Structure IPC contract', () => {
  it('uses only the registered root and relative project with one read command', async () => {
    const request = vi.fn().mockResolvedValue(empty);
    const api = createProjectStructureApi({ request });
    expect(Object.keys(api)).toEqual(['read']);
    expect(await api.read('opaque-root', 'SET/PROJECT')).toEqual(empty);
    expect(request.mock.calls).toEqual([['v2_project_structure_read', { rootId: 'opaque-root', projectRelativePath: 'SET/PROJECT' }]]);
  });
  it.each([{ ...empty, schema: 'masterocta.project-structure:v2' }, { ...empty, projectRelativePath: 'OTHER' }])('rejects incompatible schema or wrong target', async result => {
    await expect(createProjectStructureApi({ request: vi.fn().mockResolvedValue(result) }).read('root', 'SET/PROJECT')).rejects.toThrow('CONTRACT_MISMATCH');
  });
});
