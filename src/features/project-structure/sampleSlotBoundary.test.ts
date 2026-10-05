import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SlotReference } from '../../api/projectStructure';
import apiSource from '../../api/projectStructure.ts?raw';
import viewerSource from './ProjectStructureViewer.tsx?raw';

/** #187 / docs/planning/SAMPLE_SLOT_AUDIOASSET_BOUNDARY.md: the Project line holds slot references only. */
const sources = {
  'src/api/projectStructure.ts': apiSource,
  'src/features/project-structure/ProjectStructureViewer.tsx': viewerSource,
};

/** Exact barrels. A prefix match would also flag the Project line's own `src/api/projectStructure`. */
const sampleLineExact = ['src/api', 'src/api/index'];
const sampleLinePrefixes = [
  'src/api/audio',
  'src/api/changes',
  'src/api/clones',
  'src/api/derivations',
  'src/api/metadata',
  'src/api/rename',
  'src/api/slices',
  'src/features/library',
  'src/features/slicing',
  'src/features/audio',
];

function imports(source: string): { typeOnly: boolean; from: string }[] {
  return [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)';/gm)].map(match => ({ typeOnly: Boolean(match[1]), from: match[2] }));
}

function resolveSpecifier(sourcePath: string, specifier: string): string {
  const stack = sourcePath.split('/').slice(0, -1);
  for (const part of specifier.replace(/\.(tsx?|jsx?)$/, '').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

function isSampleLineModule(resolved: string): boolean {
  if (sampleLineExact.includes(resolved)) return true;
  return sampleLinePrefixes.some(prefix => resolved === prefix || resolved.startsWith(`${prefix}/`));
}

describe('Sample Slot ↔ AudioAsset boundary (Project line)', () => {
  it('slot references carry only the slot identity, never an asset, file, hash, or path', () => {
    expectTypeOf<Extract<SlotReference, { kind: 'slot' }>>().toEqualTypeOf<{ kind: 'slot'; slotKind: 'static' | 'flex'; number: number }>();
    expect(apiSource).not.toMatch(/contentHash|assetId|fileInstanceId|referencedFileRelativePath|derivation|lineage/);
  });

  it('resolves Sample-line specifiers from the guarded source directory, including descendants', () => {
    expect(isSampleLineModule(resolveSpecifier('src/api/projectStructure.ts', './audio'))).toBe(true);
    expect(isSampleLineModule(resolveSpecifier('src/api/projectStructure.ts', './audio/peaks'))).toBe(true);
    expect(isSampleLineModule(resolveSpecifier('src/features/project-structure/ProjectStructureViewer.tsx', '../library/CatalogWorkspaceViews'))).toBe(true);
    expect(isSampleLineModule(resolveSpecifier('src/features/project-structure/ProjectStructureViewer.tsx', '../../api'))).toBe(true);
    expect(isSampleLineModule(resolveSpecifier('src/api/projectStructure.ts', './client'))).toBe(false);
    expect(isSampleLineModule(resolveSpecifier('src/features/project-structure/ProjectStructureViewer.tsx', '../../api/projectStructure'))).toBe(false);
  });

  it.each(Object.entries(sources))('%s imports Sample-line modules for types only and calls no IPC directly', (sourcePath, source) => {
    const found = imports(source);
    expect(found.length).toBeGreaterThan(0);
    for (const entry of found) {
      if (!entry.from.startsWith('.')) continue;
      const resolved = resolveSpecifier(sourcePath, entry.from);
      if (isSampleLineModule(resolved)) expect(entry, `${sourcePath} -> ${resolved}`).toMatchObject({ typeOnly: true });
    }
    expect(source).not.toMatch(/@tauri-apps\/api|invoke\(/);
  });
});
