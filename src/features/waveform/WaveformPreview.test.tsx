import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioApi, AudioWaveformWindow } from '../../api';
import { waveformApiStubs, waveformFixture } from '../../test/audioApiStubs';
import { WaveformPreview } from './WaveformPreview';
function api(): AudioApi {
  return { ...waveformApiStubs(), getWaveform: vi.fn(), createPreviewToken: vi.fn(), readPreview: vi.fn().mockResolvedValue(new Uint8Array([82, 73, 70, 70]).buffer) };
}
const props = { rootId: 'root-opaque', assetId: 'asset:v1:opaque', displayName: 'kick.wav' };
async function selectRange(start: string, end: string) {
  await screen.findByRole('img', { name: 'Audio waveform' });
  fireEvent.change(screen.getByLabelText('Selection start frame'), { target: { value: start } });
  fireEvent.change(screen.getByLabelText('Selection end frame'), { target: { value: end } });
  fireEvent.click(screen.getByRole('button', { name: 'Set range' }));
}
describe('Waveform 2.0', () => {
  beforeEach(() => { vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }); });
  afterEach(() => vi.unstubAllGlobals());
  it('requests source-frame peaks and independently renders both stereo channels', async () => {
    const client = api(); render(<WaveformPreview {...props} api={client} />);
    const plot = await screen.findByRole('img', { name: 'Audio waveform' });
    expect(client.queryWaveform).toHaveBeenCalledWith(props.rootId, props.assetId, { range: null, targetPoints: 800 });
    expect(plot.querySelector('[data-channel="0"]')).toBeInTheDocument();
    expect(plot.querySelector('[data-channel="1"]')).toBeInTheDocument();
    expect(plot.querySelector('[data-channel="0"]')?.getAttribute('d')).not.toBe(plot.querySelector('[data-channel="1"]')?.getAttribute('d'));
    fireEvent.change(screen.getByLabelText('Waveform channels'), { target: { value: 'right' } });
    expect(plot.querySelector('[data-channel="0"]')).not.toBeInTheDocument();
    expect(plot.querySelector('[data-channel="1"]')).toBeInTheDocument();
    expect(client.getWaveform).not.toHaveBeenCalled();
  });
  it('requests new detail on zoom and preserves selection independently of the viewport', async () => {
    const client = api(); render(<WaveformPreview {...props} api={client} />);
    await selectRange('100', '132');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom selection' }));
    await waitFor(() => expect(client.queryWaveform).toHaveBeenLastCalledWith(props.rootId, props.assetId, { range: { startFrame: '100', endFrame: '132' }, targetPoints: 800 }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fit' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    await waitFor(() => expect(client.queryWaveform).toHaveBeenLastCalledWith(props.rootId, props.assetId, { range: null, targetPoints: 800 }));
    expect(screen.getByLabelText('Selection start frame')).toHaveValue('100');
    expect(screen.getByLabelText('Selection end frame')).toHaveValue('132');
  });
  it('previews an exact selected range beyond 60 seconds through a root-bound token', async () => {
    const client = api(); vi.mocked(client.queryWaveform).mockImplementation((_root, _asset, query) => Promise.resolve(waveformFixture(query, '62000', 1000)));
    render(<WaveformPreview {...props} api={client} />);
    await selectRange('61000', '62000');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load preview' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Load preview' }));
    expect(await screen.findByLabelText('Preview kick.wav')).toHaveAttribute('src', 'blob:preview');
    expect(client.createRangePreviewToken).toHaveBeenCalledWith(props.rootId, props.assetId, { startFrame: '61000', endFrame: '62000' });
    expect(client.readPreview).toHaveBeenCalledWith(props.rootId, 'preview:v1:opaque');
    expect(client.createPreviewToken).not.toHaveBeenCalled();
  });
  it('rejects malformed/outside ranges before preview or detail IPC', async () => {
    const client = api(); render(<WaveformPreview {...props} api={client} />);
    await selectRange('01', '999999');
    expect(await screen.findByRole('alert')).toHaveTextContent('whole source frame');
    expect(screen.getByRole('button', { name: 'Zoom selection' })).toBeDisabled();
    expect(client.createRangePreviewToken).not.toHaveBeenCalled();
  });
  it('rejects mismatched preview bytes and releases the previous object URL', async () => {
    const client = api(); render(<WaveformPreview {...props} api={client} />);
    await screen.findByRole('img', { name: 'Audio waveform' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load preview' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Load preview' }));
    await screen.findByLabelText('Preview kick.wav');
    vi.mocked(client.readPreview).mockResolvedValue(new Uint8Array([1]).buffer);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load preview' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Load preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Preview response failed validation');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
  it('does not show an old asset or create a Blob when a preview outlives the selection', async () => {
    const client = api(); let finish: ((bytes: ArrayBuffer) => void) | undefined;
    vi.mocked(client.readPreview).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<WaveformPreview {...props} api={client} />);
    await screen.findByRole('img', { name: 'Audio waveform' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load preview' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Load preview' }));
    await waitFor(() => expect(client.readPreview).toHaveBeenCalled());
    view.rerender(<WaveformPreview {...props} assetId="asset:new" displayName="new.wav" api={client} />);
    expect(screen.queryByRole('img', { name: 'Audio waveform' })).not.toBeInTheDocument();
    await act(async () => finish?.(new Uint8Array([82, 73, 70, 70]).buffer));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    await screen.findByRole('img', { name: 'Audio waveform' });
    expect(screen.getByRole('button', { name: 'Load preview' })).toBeEnabled();
  });
  it('discards a pending preview when its selected range changes', async () => {
    const client = api(); let finish: ((bytes: ArrayBuffer) => void) | undefined;
    vi.mocked(client.readPreview).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<WaveformPreview {...props} api={client} />);
    await selectRange('100', '132');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load preview' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Load preview' }));
    await waitFor(() => expect(client.readPreview).toHaveBeenCalled());
    await selectRange('200', '232');
    await act(async () => finish?.(new Uint8Array([82, 73, 70, 70]).buffer));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Load preview' })).toBeEnabled();
  });
  it('discards stale waveform responses when an asset changes', async () => {
    const client = api(); let finish: ((waveform: AudioWaveformWindow) => void) | undefined;
    vi.mocked(client.queryWaveform).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(<WaveformPreview {...props} api={client} />);
    await waitFor(() => expect(client.queryWaveform).toHaveBeenCalled());
    view.rerender(<WaveformPreview {...props} assetId="asset:new" api={client} />);
    await act(async () => finish?.({ ...waveformFixture(), sampleRate: 1000 }));
    expect(screen.queryByText(/1,000 Hz/)).not.toBeInTheDocument();
    await screen.findByRole('img', { name: 'Audio waveform' });
    expect(screen.getByText(/44,100 Hz/)).toBeInTheDocument();
  });
  it('shows source failure and never enables stale preview access', async () => {
    const client = api(); vi.mocked(client.queryWaveform).mockRejectedValue(new Error('source changed'));
    render(<WaveformPreview {...props} api={client} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('source changed');
    expect(screen.getByRole('button', { name: 'Load preview' })).toBeDisabled();
  });
  it('uses measured pixel width for its point budget', async () => {
    let resize: ResizeObserverCallback | undefined;
    vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe() {} disconnect() {} });
    const client = api(); render(<WaveformPreview {...props} api={client} />);
    act(() => resize?.([{ contentRect: { width: 1200 } } as ResizeObserverEntry], {} as ResizeObserver));
    await waitFor(() => expect(client.queryWaveform).toHaveBeenLastCalledWith(props.rootId, props.assetId, { range: null, targetPoints: 1200 }));
  });
});
