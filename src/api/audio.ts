import { ipcClient, type IpcClient } from "./client";

export interface WaveformPeak {
  min: number;
  max: number;
}

export interface AudioWaveform {
  analyzerVersion: string;
  sampleRate: number;
  channels: number;
  frameCount: number;
  durationSeconds: number;
  samplesPerPeak: number;
  peaks: WaveformPeak[];
}

export interface AudioPreviewToken {
  previewToken: string;
  expiresInSeconds: number;
  mimeType: string;
  byteLength: number;
  durationMillis: number;
  truncated: boolean;
}

export type AudioPreviewBytes = ArrayBuffer | number[];

export interface AudioApi {
  prepareWaveform(rootId: string, assetId: string, signal?: AbortSignal): Promise<WaveformPreparation>;
  queryWaveform(query: WaveformQuery, signal?: AbortSignal): Promise<WaveformResponseV2>;
  createRangedPreviewToken(rootId: string, assetId: string, range: FrameRange): Promise<RangedPreviewToken>;
  getWaveform(
    rootId: string,
    assetId: string,
    targetPoints: number,
  ): Promise<AudioWaveform>;
  createPreviewToken(rootId: string, assetId: string): Promise<AudioPreviewToken>;
  readPreview(rootId: string, previewToken: string): Promise<AudioPreviewBytes>;
}

export function createAudioApi(client: IpcClient = ipcClient): AudioApi {
  const queryQueue = requestQueue(2);
  return {
    prepareWaveform: (rootId, assetId, signal) => cancellable(() => client.request<WaveformPreparation>("v2_audio_waveform_prepare", { rootId, assetId }), signal),
    queryWaveform: ({ rootId, assetId, ...query }, signal) => queryQueue(() => client.request<WaveformResponseV2>("v2_audio_waveform_query", { rootId, assetId, query }), signal),
    createRangedPreviewToken: (rootId, assetId, range) => client.request<RangedPreviewToken>("v2_audio_preview_range_create", { rootId, assetId, range }),
    getWaveform: (rootId, assetId, targetPoints) =>
      client.request<AudioWaveform>("v2_audio_waveform_get", {
        rootId,
        assetId,
        targetPoints,
      }),
    createPreviewToken: (rootId, assetId) =>
      client.request<AudioPreviewToken>("v2_audio_preview_create", {
        rootId,
        assetId,
      }),
    readPreview: (rootId, previewToken) =>
      client.request<AudioPreviewBytes>("v2_audio_preview_read", {
        rootId,
        previewToken,
      }),
  };
}

export const audioApi = createAudioApi();

export interface FrameRange { startFrame: number; endFrameExclusive: number }
export interface WaveformMetadata { sampleRate: number; channelCount: number; totalFrames: number }
export interface WaveformQuery extends FrameRange {
  rootId: string;
  assetId: string;
  targetPoints: number;
  channelMode: "separate";
}
export interface WaveformResponseV2 extends WaveformMetadata {
  schema: "waveform-query:v2";
  analyzerVersion: "waveform:v2";
  range: FrameRange;
  bucketBoundaries: number[];
  channels: Array<{ channelIndex: number; peaks: Array<{ min: number; max: number; rms: number; frameCount: number }> }>;
}
export interface WaveformPreparation {
  state: "MISSING" | "QUEUED" | "GENERATING" | "READY" | "UNSUPPORTED" | "SOURCE_CHANGED" | "DECODE_FAILED" | "CACHE_UNSAFE" | "CANCELLED";
  metadata: WaveformMetadata | null;
  errorCode: string | null;
}
export interface RangedPreviewToken extends AudioPreviewToken {
  range: FrameRange;
  sampleRate: number;
  truncationReason?: "byteLimit" | "durationLimit";
}

/** Cancels the consumer, not a shared backend cache job. */
function cancellable<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Cancelled", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(operation).then(resolve, reject).finally(() => signal?.removeEventListener("abort", abort));
  });
}

/** Bound actual IPC work even when cancelled consumers stop awaiting it. */
function requestQueue(concurrency: number) {
  let active = 0;
  const pending: Array<() => void> = [];
  function pump() {
    while (active < concurrency && pending.length) pending.shift()?.();
  }
  return <T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> => cancellable(() => new Promise<T>((resolve, reject) => {
    pending.push(() => {
      if (signal?.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
      active += 1;
      Promise.resolve().then(operation).then(resolve, reject).finally(() => { active -= 1; pump(); });
    });
    pump();
  }), signal);
}
