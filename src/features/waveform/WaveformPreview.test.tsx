import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioApi, WaveformQuery, WaveformResponseV2 } from "../../api";
import { WaveformPreview } from "./WaveformPreview";
import { PreviewController, PreviewProvider } from "./PreviewController";
import { frameAt, requestedPoints, zoomRange } from "./geometry";

function response(q: WaveformQuery): WaveformResponseV2 {
  const boundaries = Array.from({ length: q.targetPoints + 1 }, (_, i) => q.startFrame + Math.floor((q.endFrameExclusive - q.startFrame) * i / q.targetPoints));
  return { schema: "waveform-query:v2", analyzerVersion: "waveform:v2", sampleRate: 1000, channelCount: 2, totalFrames: 120000,
    range: { startFrame: q.startFrame, endFrameExclusive: q.endFrameExclusive }, bucketBoundaries: boundaries,
    channels: [0,1].map(channelIndex => ({ channelIndex, peaks: boundaries.slice(1).map((end, i) => ({ min: -0.5, max: 0.75, rms: 0.3, frameCount: end - boundaries[i] })) })) };
}
function api(): AudioApi {
  return {
    getWaveform: vi.fn(), createPreviewToken: vi.fn(),
    prepareWaveform: vi.fn().mockResolvedValue({ state: "READY", metadata: { sampleRate: 1000, channelCount: 2, totalFrames: 120000 }, errorCode: null }),
    queryWaveform: vi.fn(async q => response(q)),
    createRangedPreviewToken: vi.fn(async (_root, _asset, range) => ({ previewToken: "preview:v1:opaque", expiresInSeconds: 120, mimeType: "audio/wav", byteLength: 48, durationMillis: 1, truncated: false, sampleRate: 1000, range: { startFrame: range.startFrame, endFrameExclusive: Math.min(range.endFrameExclusive, range.startFrame + 1) } })),
    readPreview: vi.fn().mockResolvedValue(new ArrayBuffer(48)),
  };
}
let width = 400;
let resized: () => void;
beforeEach(() => {
  width = 400;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width, height: 240, left: 0, top: 0, right: width, bottom: 240, x: 0, y: 0, toJSON: () => ({}) }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ setTransform: vi.fn(), clearRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} });
  vi.stubGlobal("PointerEvent", MouseEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Waveform 2.0", () => {
  it("queries exactly the measured pixel width, then responds to resizing", async () => {
    const client = api(); render(<WaveformPreview api={client} rootId="root" assetId="asset" displayName="stereo.wav" />);
    expect(await screen.findByRole("img", { name: /independent L and R/ })).toBeInTheDocument();
    expect(client.queryWaveform).toHaveBeenCalledWith(expect.objectContaining({ rootId: "root", assetId: "asset", targetPoints: 400 }), expect.any(AbortSignal));
    act(() => { width = 900; resized(); });
    await waitFor(() => expect(client.queryWaveform).toHaveBeenCalledWith(expect.objectContaining({ targetPoints: 900 }), expect.any(AbortSignal)));
  });
  it("zooms around the pointer and pans using range queries, retaining selection frames", async () => {
    const client = api(); render(<WaveformPreview api={client} rootId="root" assetId="asset" displayName="stereo.wav" />);
    await screen.findByRole("img", { name: /independent L and R/ });
    const plot = screen.getByRole("group", { name: "Waveform navigation" });
    fireEvent.pointerDown(plot, { button: 0, clientX: 100 }); fireEvent.pointerMove(plot, { clientX: 200 }); fireEvent.pointerUp(plot, { clientX: 200 });
    expect(screen.getByText(/Selection \[30000, 60000\)/)).toBeInTheDocument();
    fireEvent.wheel(plot, { deltaY: -300, clientX: 200 });
    await waitFor(() => expect(client.queryWaveform).toHaveBeenCalledWith(expect.objectContaining({ startFrame: expect.any(Number), endFrameExclusive: expect.any(Number) }), expect.any(AbortSignal)));
    expect(screen.getByText(/Selection \[30000, 60000\)/)).toBeInTheDocument();
    fireEvent.keyDown(plot, { key: "Escape" }); expect(screen.queryByText(/Selection \[/)).not.toBeInTheDocument();
    fireEvent.keyDown(plot, { key: "ArrowRight" }); expect(screen.getByText(/Frame 1 ·/)).toBeInTheDocument();
    fireEvent.keyDown(plot, { key: "F" });
    await waitFor(() => expect(client.queryWaveform).toHaveBeenLastCalledWith(expect.objectContaining({ startFrame: 0, endFrameExclusive: 120000 }), expect.any(AbortSignal)));
  });
  it("loads a selection's frame range through one-shot preview", async () => {
    const client = api(); render(<WaveformPreview api={client} rootId="root" assetId="asset" displayName="stereo.wav" />);
    await screen.findByRole("img", { name: /independent L and R/ });
    const plot = screen.getByRole("group", { name: "Waveform navigation" });
    fireEvent.pointerDown(plot, { button: 0, clientX: 250 }); fireEvent.pointerMove(plot, { clientX: 300 }); fireEvent.pointerUp(plot, { clientX: 300 });
    fireEvent.click(screen.getByRole("button", { name: "Load selection preview" }));
    await waitFor(() => expect(client.createRangedPreviewToken).toHaveBeenCalledWith("root", "asset", { startFrame: 75000, endFrameExclusive: 90000 }));
    expect(await screen.findByText(/Preview \[75000, 75001\)/)).toBeInTheDocument();
    expect(client.readPreview).toHaveBeenCalledWith("root", "preview:v1:opaque");
  });
  it("aborts stale queries and clears a pending preview when selection changes", async () => {
    const client = api(); let finish: ((b: ArrayBuffer) => void) | undefined;
    vi.mocked(client.readPreview).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<PreviewProvider><WaveformPreview api={client} rootId="root" assetId="old" displayName="old.wav" /></PreviewProvider>);
    await screen.findByRole("img", { name: /independent L and R/ });
    fireEvent.click(screen.getByRole("button", { name: "Load preview" }));
    await waitFor(() => expect(client.readPreview).toHaveBeenCalled());
    const oldSignal = vi.mocked(client.queryWaveform).mock.calls[0][1];
    vi.mocked(URL.createObjectURL).mockClear();
    view.rerender(<PreviewProvider><WaveformPreview api={client} rootId="root" assetId="new" displayName="new.wav" /></PreviewProvider>);
    await act(async () => { finish?.(new ArrayBuffer(48)); });
    expect(oldSignal?.aborted).toBe(true); expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Load preview" })).toBeEnabled();
  });
  it("resets the frame clock when switching away from a loaded ranged preview", async () => {
    const client = api();
    const view = render(<PreviewProvider><WaveformPreview api={client} rootId="root" assetId="old" displayName="old.wav" /></PreviewProvider>);
    await screen.findByRole("img", { name: /independent L and R/ });
    const plot = screen.getByRole("group", { name: "Waveform navigation" });
    fireEvent.pointerDown(plot, { button: 0, clientX: 250 }); fireEvent.pointerMove(plot, { clientX: 300 }); fireEvent.pointerUp(plot, { clientX: 300 });
    fireEvent.click(screen.getByRole("button", { name: "Load selection preview" }));
    expect(await screen.findByText(/Preview \[75000, 75001\)/)).toBeInTheDocument();
    expect(screen.getByText(/Frame 75000 ·/)).toBeInTheDocument();
    view.rerender(<PreviewProvider><WaveformPreview api={client} rootId="root" assetId="new" displayName="new.wav" /></PreviewProvider>);
    await screen.findByRole("img", { name: /independent L and R/ });
    expect(screen.getByText(/Frame 0 · 0.000s/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
  });
  it("fails closed on a waveform/source error", async () => {
    const client = api(); vi.mocked(client.prepareWaveform).mockResolvedValue({ state: "SOURCE_CHANGED", metadata: null, errorCode: "AUDIO_SOURCE_CHANGED" });
    render(<WaveformPreview api={client} rootId="root" assetId="asset" displayName="changed.wav" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("AUDIO_SOURCE_CHANGED");
    expect(screen.getByRole("button", { name: "Load preview" })).toBeDisabled();
  });
  it("keeps both canvases cleared when a parallel query finishes after a source error", async () => {
    const client = api();
    const pending: Array<{ query: WaveformQuery; resolve: (value: WaveformResponseV2) => void; reject: (reason: Error) => void }> = [];
    vi.mocked(client.queryWaveform).mockImplementation(query => new Promise((resolve, reject) => pending.push({ query, resolve, reject })));
    render(<WaveformPreview api={client} rootId="root" assetId="asset" displayName="changed.wav" />);
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[0].reject(new Error("AUDIO_SOURCE_CHANGED")); });
    await act(async () => { pending[1].resolve(response(pending[1].query)); });
    expect(screen.getByRole("alert")).toHaveTextContent("AUDIO_SOURCE_CHANGED");
    expect(screen.queryByRole("img", { name: /independent L and R/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load preview" })).toBeDisabled();
    vi.mocked(client.queryWaveform).mockImplementation(async query => response(query));
    fireEvent.click(screen.getByRole("button", { name: "Retry waveform" }));
    expect(await screen.findByRole("img", { name: /independent L and R/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("rejects invalid tickets before fetching bytes", async () => {
    const client = api(); vi.mocked(client.createRangedPreviewToken).mockResolvedValue({ previewToken: "bad", expiresInSeconds: 120, mimeType: "audio/wav", byteLength: 33 * 1024 * 1024, durationMillis: 1, truncated: false, sampleRate: 1000, range: { startFrame: 0, endFrameExclusive: 1 } });
    const controller = new PreviewController();
    await controller.load(client, "owner", "root", "asset", { startFrame: 0, endFrameExclusive: 1000 });
    expect(controller.snapshot().error).toBe("Preview response failed validation."); expect(client.readPreview).not.toHaveBeenCalled(); controller.reset();
  });
  it("preserves pointer anchor and integer frames at extreme zoom", () => {
    const range = zoomRange({ startFrame: 100, endFrameExclusive: 1100 }, 0.25, 0.5, 10000);
    expect(frameAt(range, 0.25)).toBe(350);
    expect(zoomRange(range, 0.5, 0.00001, 10000).endFrameExclusive - zoomRange(range, 0.5, 0.00001, 10000).startFrame).toBe(1);
    expect(requestedPoints(800, 2, 120000)).toBe(1600); expect(requestedPoints(800, 2, 3)).toBe(3);
  });
});
