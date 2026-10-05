import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SlotReference } from '../../api/projectStructure';
import apiSource from '../../api/projectStructure.ts?raw';
import viewerSource from './ProjectStructureViewer.tsx?raw';

/** #187 / docs/planning/SAMPLE_SLOT_AUDIOASSET_BOUNDARY.md: the Project line holds slot references only. */
const sources = { 'api/projectStructure.ts': apiSource, 'ProjectStructureViewer.tsx': viewerSource };
const sampleLineModules = /(^|\/)(api|api\/index|api\/audio|api\/changes|api\/clones|api\/derivations|api\/metadata|api\/rename|api\/slices|features\/library|features\/slicing|features\/audio)(\.tsx?)?$/;

function imports(source: string): { typeOnly: boolean; from: string }[] {
  return [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)';/gm)].map(match => ({ typeOnly: Boolean(match[1]), from: match[2] }));
}

describe('Sample Slot ↔ AudioAsset boundary (Project line)', () => {
  it('slot references carry only the slot identity, never an asset, file, hash, or path', () => {
    expectTypeOf<Extract<SlotReference, { kind: 'slot' }>>().toEqualTypeOf<{ kind: 'slot'; slotKind: 'static' | 'flex'; number: number }>();
    expect(apiSource).not.toMatch(/contentHash|assetId|fileInstanceId|referencedFileRelativePath|derivation|lineage/);
  });

  it.each(Object.entries(sources))('%s imports Sample-line modules for types only and calls no IPC directly', (_name, source) => {
    const found = imports(source);
    expect(found.length).toBeGreaterThan(0);
    for (const entry of found) {
      if (sampleLineModules.test(entry.from.replace(/^(\.\.?\/)+/, ''))) expect(entry, entry.from).toMatchObject({ typeOnly: true });
    }
    expect(source).not.toMatch(/@tauri-apps\/api|invoke\(/);
  });
});
