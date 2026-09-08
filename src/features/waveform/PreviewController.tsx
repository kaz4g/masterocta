import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AudioApi, FrameRange } from "../../api";

interface PreviewState {
  loading: boolean; playing: boolean; frame: number; error: string | null;
  range: FrameRange | null; sampleRate: number; truncated: boolean; truncationReason?: string;
}
const initial: PreviewState = { loading: false, playing: false, frame: 0, error: null, range: null, sampleRate: 0, truncated: false };

/** One owner and one playback clock per workspace; source changes invalidate pending loads. */
export class PreviewController {
  private state: PreviewState = initial;
  private listeners = new Set<() => void>();
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;
  private generation = 0;
  private owner = "";
  private animation = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private update(patch: Partial<PreviewState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  claim(owner: string) { if (owner !== this.owner) { this.reset(); this.owner = owner; } }
  release(owner: string) { if (owner === this.owner) { this.reset(); this.owner = ""; } }
  reset() {
    this.generation += 1;
    cancelAnimationFrame(this.animation);
    if (this.audio) {
      this.audio.onplaying = this.audio.onpause = this.audio.onended = this.audio.ontimeupdate = this.audio.onerror = null;
      this.audio.pause(); this.audio.removeAttribute("src"); this.audio.load(); this.audio = null;
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null; this.state = { ...initial }; this.listeners.forEach(listener => listener());
  }
  private tick = () => {
    if (!this.audio || !this.state.range) return;
    this.update({ frame: Math.min(this.state.range.endFrameExclusive, this.state.range.startFrame + Math.floor(this.audio.currentTime * this.state.sampleRate)) });
    if (!this.audio.paused) this.animation = requestAnimationFrame(this.tick);
  };
  async load(api: AudioApi, owner: string, root: string, asset: string, range: FrameRange) {
    this.claim(owner); this.reset(); this.owner = owner;
    const generation = this.generation;
    this.update({ loading: true });
    try {
      const ticket = await api.createRangedPreviewToken(root, asset, range);
      if (generation !== this.generation) return false;
      if (ticket.mimeType !== "audio/wav" || !Number.isSafeInteger(ticket.byteLength) || ticket.byteLength < 44 || ticket.byteLength > 32 * 1024 * 1024 ||
          !Number.isSafeInteger(ticket.sampleRate) || ticket.sampleRate <= 0 || !ticket.range ||
          ticket.range.startFrame !== range.startFrame || !Number.isSafeInteger(ticket.range.endFrameExclusive) ||
          ticket.range.endFrameExclusive > range.endFrameExclusive || ticket.range.endFrameExclusive <= range.startFrame ||
          ticket.range.endFrameExclusive - range.startFrame > ticket.sampleRate * 60) throw new Error("Preview response failed validation.");
      const bytes = await api.readPreview(root, ticket.previewToken);
      if (generation !== this.generation) return false;
      const buffer = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
      if (buffer.byteLength !== ticket.byteLength) throw new Error("Preview response failed validation.");
      this.url = URL.createObjectURL(new Blob([buffer], { type: ticket.mimeType }));
      this.audio = new Audio(this.url);
      this.audio.onplaying = () => { this.update({ playing: true }); cancelAnimationFrame(this.animation); this.tick(); };
      this.audio.onpause = () => { cancelAnimationFrame(this.animation); this.update({ playing: false }); };
      this.audio.onended = () => { cancelAnimationFrame(this.animation); this.update({ playing: false, frame: ticket.range.endFrameExclusive }); };
      this.audio.ontimeupdate = () => { if (this.audio?.paused) this.tick(); };
      this.audio.onerror = () => this.update({ playing: false, error: "Preview playback failed." });
      this.update({ loading: false, range: ticket.range, sampleRate: ticket.sampleRate, frame: ticket.range.startFrame, truncated: ticket.truncated, truncationReason: ticket.truncationReason });
      return true;
    } catch (error) {
      if (generation === this.generation) this.update({ loading: false, error: error instanceof Error ? error.message : "Preview could not be loaded." });
      return false;
    }
  }
  async toggle() {
    if (!this.audio) return;
    if (!this.audio.paused) { this.audio.pause(); return; }
    const generation = this.generation;
    try { await this.audio.play(); } catch { if (generation === this.generation) this.update({ error: "Preview playback could not start." }); }
  }
  seek(frame: number) {
    if (!this.audio || !this.state.range) return false;
    if (frame < this.state.range.startFrame || frame >= this.state.range.endFrameExclusive) { this.audio.pause(); return false; }
    this.audio.currentTime = (frame - this.state.range.startFrame) / this.state.sampleRate;
    this.update({ frame }); return true;
  }
}
const PreviewContext = createContext<PreviewController | null>(null);
export function PreviewProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new PreviewController());
  useEffect(() => () => controller.reset(), [controller]);
  return <PreviewContext.Provider value={controller}>{children}</PreviewContext.Provider>;
}
export function usePreviewController() {
  const shared = useContext(PreviewContext);
  const [local] = useState(() => new PreviewController());
  const controller = shared ?? local;
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  return { controller, state };
}
