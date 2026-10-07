import { ipcClient, type IpcClient } from './client';

/** Mirrors project_structure_command.rs v4. Indices are zero-based; slot numbers are one-based. */
export type DocumentRole = 'working' | 'savedCheckpoint';
export type ParseStatus = 'parsed' | 'unsupportedVersion' | 'malformed';
export type Selection = { kind: 'selected'; index: number } | { kind: 'unrecognized'; raw: number };
export type PlaybackScale = { kind: 'times2' | 'times3Over2' | 'times1' | 'times3Over4' | 'times1Over2' | 'times1Over4' | 'times1Over8' } | { kind: 'unrecognized'; raw: number };
export type MasterLength = { kind: 'finite'; steps: number } | { kind: 'infinite' } | { kind: 'unrecognized'; multiplier: number; length: number };
export type PatternScale =
  | { kind: 'normal'; masterLength: number; masterScale: PlaybackScale }
  | { kind: 'perTrack'; masterLength: MasterLength; masterScale: PlaybackScale; tracks: { track: number; length: number; scale: PlaybackScale }[] }
  | { kind: 'unrecognized'; raw: number };
export type SlotReference =
  | { kind: 'slot'; slotKind: 'static' | 'flex'; number: number }
  | { kind: 'unassigned' | 'noSampleMachine' }
  | { kind: 'recorderBuffer'; bufferNumber: number }
  | { kind: 'unrecognized'; raw: number };
export type Machine = { kind: 'static' | 'flex' | 'thru' | 'neighbor' | 'pickup' } | { kind: 'unknown'; raw: number };
export interface StructureTrack {
  index: number;
  playback: { kind: 'master' } | { kind: 'audio'; machine: Machine; slot: SlotReference };
}
export interface StructureBank {
  index: number;
  letter: string;
  role: DocumentRole;
  sourceRelativePath: string;
  parseStatus: ParseStatus;
  patterns: { index: number; partIndex: number; scale: PatternScale }[];
  parts: { index: number; tracks: StructureTrack[] }[];
  unmodeledDependencies: string[];
}
export interface ProjectStructure {
  schema: 'masterocta.project-structure:v4';
  projectRelativePath: string;
  projectState: {
    role: DocumentRole;
    sourceRelativePath: string;
    parseStatus: ParseStatus;
    bank: Selection | null;
    pattern: Selection | null;
    arrangement: Selection | null;
    masterTrack: boolean | null;
  } | null;
  banks: StructureBank[];
}
export interface ProjectStructureApi {
  read(rootId: string, projectRelativePath: string): Promise<ProjectStructure>;
}
export function createProjectStructureApi(client: IpcClient = ipcClient): ProjectStructureApi {
  return {
    async read(rootId, projectRelativePath) {
      const result = await client.request<ProjectStructure>('v2_project_structure_read', { rootId, projectRelativePath });
      if (result.schema !== 'masterocta.project-structure:v4' || result.projectRelativePath !== projectRelativePath) {
        throw new Error('PROJECT_STRUCTURE_CONTRACT_MISMATCH');
      }
      return result;
    },
  };
}
export const projectStructureApi = createProjectStructureApi();
