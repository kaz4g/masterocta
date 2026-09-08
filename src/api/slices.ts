import { ipcClient, type IpcClient } from "./client";

// Canonical source-PCM coordinates. Never coerce an absolute frame to Number.
export interface SliceRange { startFrame: string; endExclusive: string }
export interface OnsetParameters {
  sensitivity: number;
  minimumIntervalMs: number;
  preRollUs: number;
  silenceFloorDb: number;
  snapRadiusUs: number;
}
export const defaultOnsetParameters: OnsetParameters = {
  sensitivity: 50, minimumIntervalMs: 35, preRollUs: 1000,
  silenceFloorDb: -72, snapRadiusUs: 0,
};
export interface SliceJob {
  jobId: string;
  phase: "reading" | "analyzing" | "ready" | "cancelled" | "failed";
  error: { code: string; message: string } | null;
  sampleRate: number | null;
  channels: number | null;
  frameCount: string | null;
  region: SliceRange | null;
}
export interface SliceMarker {
  markerId: string;
  startFrame: string;
  endExclusive: string;
  locked: boolean;
  manual: boolean;
}
export interface SliceDraft {
  revision: number;
  region: SliceRange;
  markers: SliceMarker[];
  canUndo: boolean;
  canRedo: boolean;
}
export interface OnsetCandidate {
  candidateId: string;
  noveltyPeakFrame: string;
  estimatedAttackFrame: string;
  suggestedStartFrame: string;
  strength: number;
  bandScores: [number, number, number];
  thresholdMargin: number;
  uncertainty: SliceRange;
  warnings: string[];
}
export interface SliceProposal {
  proposalId: string;
  expectedRevision: number;
  candidateCount: number;
  candidates: OnsetCandidate[];
  suppressedCount: number;
  exceedsDraftLimit: boolean;
}
export type SliceEdit =
  | { kind: "acceptProposal"; proposalId: string }
  | { kind: "move"; markerId: string; frame: string }
  | { kind: "insert"; frame: string }
  | { kind: "delete"; markerId: string }
  | { kind: "setLock"; markerId: string; locked: boolean }
  | { kind: "undo" | "redo" };
export interface SliceWaveform { range: SliceRange; peaks: [number, number][][] }
export interface SlicePreview {
  previewToken: string;
  sampleRate: number;
  channels: number;
  frameCount: string;
  byteLength: number;
}
export function createSliceApi(client: IpcClient = ipcClient) {
  return {
    start: (rootId: string, fileInstanceId: string, region?: SliceRange) =>
      client.request<SliceJob>("v2_audio_onsets_start", { rootId, fileInstanceId, region: region ?? null }),
    status: (rootId: string, jobId: string) =>
      client.request<SliceJob>("v2_audio_onsets_status", { rootId, jobId }),
    cancel: (rootId: string, jobId: string) =>
      client.request<void>("v2_audio_onsets_cancel", { rootId, jobId }),
    draft: (rootId: string, jobId: string) =>
      client.request<SliceDraft>("v2_slice_draft_get", { rootId, jobId }),
    propose: (rootId: string, jobId: string, expectedRevision: number, parameters: OnsetParameters) =>
      client.request<SliceProposal>("v2_slice_proposal_create", { rootId, jobId, expectedRevision, parameters }),
    edit: (rootId: string, jobId: string, expectedRevision: number, edit: SliceEdit) =>
      client.request<SliceDraft>("v2_slice_draft_update", { rootId, jobId, expectedRevision, edit }),
    waveform: (rootId: string, jobId: string, range: SliceRange, points: number) =>
      client.request<SliceWaveform>("v2_audio_waveform_range_get", { rootId, jobId, range, points }),
    preview: (rootId: string, jobId: string, range: SliceRange) =>
      client.request<SlicePreview>("v2_audio_preview_region_create", { rootId, jobId, range }),
    readPreview: (rootId: string, jobId: string, previewToken: string) =>
      client.request<ArrayBuffer | number[]>("v2_audio_preview_region_read", { rootId, jobId, previewToken }),
  };
}
export type SliceApi = ReturnType<typeof createSliceApi>;
export const sliceApi = createSliceApi();
