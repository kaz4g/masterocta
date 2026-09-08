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

/** Canonical decimal u64 source PCM frames, with an exclusive end. */
export interface AudioFrameRange { startFrame: string; endFrame: string; }
export interface AudioWaveformQuery { range: AudioFrameRange | null; targetPoints: number; }
export interface AudioWaveformWindow {
  analyzerVersion: 'waveform:v2';
  sampleRate: number;
  channels: number;
  frameCount: string;
  range: AudioFrameRange;
  framesPerPeak: string;
  channelPeaks: WaveformPeak[][];
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
  queryWaveform(rootId: string, assetId: string, query: AudioWaveformQuery): Promise<AudioWaveformWindow>;
  createRangePreviewToken(rootId: string, assetId: string, range: AudioFrameRange): Promise<AudioPreviewToken>;
  getWaveform(
    rootId: string,
    assetId: string,
    targetPoints: number,
  ): Promise<AudioWaveform>;
  createPreviewToken(rootId: string, assetId: string): Promise<AudioPreviewToken>;
  readPreview(rootId: string, previewToken: string): Promise<AudioPreviewBytes>;
}

export function createAudioApi(client: IpcClient = ipcClient): AudioApi {
  return {
    queryWaveform: (rootId, assetId, query) =>
      client.request<AudioWaveformWindow>('v2_audio_waveform_query', { rootId, assetId, query }),
    createRangePreviewToken: (rootId, assetId, range) =>
      client.request<AudioPreviewToken>('v2_audio_preview_range_create', { rootId, assetId, range }),
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
