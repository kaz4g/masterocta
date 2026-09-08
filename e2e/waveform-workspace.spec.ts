import { expect, test } from '@playwright/test';

// Synthetic IPC data only; this suite does not register or write real media.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as any;
    state.__E2E_ROOT_PATH__ = '/tmp/generated-waveform-fixture';
    state.__WF_CALLS__ = [];
    let previewBytes: number[] = [];
    state.__TAURI_INTERNALS__ = {
      transformCallback: () => {},
      invoke: async (command: string, args: any = {}) => {
        state.__WF_CALLS__.push({ command, args });
        if (command === 'v2_root_register' || command === 'v2_root_status') return {
          rootId: 'root:waveform-fixture', displayName: 'Waveform fixture', deviceFingerprint: 'fixture-fingerprint',
          mode: 'read_only', observedRevision: 1, expiresInSeconds: 3600,
          capabilities: { read: true, write: false, stableDeviceIdentity: true },
        };
        if (command === 'v2_library_list') return {
          sets: [{ displayName: 'SYNTHETIC_SET', relativePath: 'SYNTHETIC_SET', hasAudioPool: true, projects: [] }],
          standaloneProjects: [], usageEdges: [],
          audioFiles: Array.from({ length: 230 }, (_, index) => ({
            fileInstanceId: `instance:${index}`, assetId: `asset:${index}`, displayName: `Break_${String(index).padStart(3, '0')}.wav`,
            relativePath: `SYNTHETIC_SET/AUDIO/Break_${String(index).padStart(3, '0')}.wav`, byteSize: 248044 + index,
            storageScope: 'set_audio_pool',
          })),
        };
        if (command === 'v2_audio_waveform_query') {
          const range = args.query.range ?? { startFrame: '0', endFrame: '62000' };
          const length = Number(range.endFrame) - Number(range.startFrame);
          const step = Math.ceil(length / args.query.targetPoints);
          const count = Math.ceil(length / step);
          return {
            analyzerVersion: 'waveform:v2', sampleRate: 1000, channels: 2, frameCount: '62000', range,
            framesPerPeak: String(step),
            channelPeaks: [0, 1].map(channel => Array.from({ length: count }, (_, i) => {
              const amp = (.1 + .7 * Math.exp(-((i + channel * 5) % 40) / 8));
              return channel ? { min: -amp, max: -.03 } : { min: .02, max: amp };
            })),
          };
        }
        if (command === 'v2_audio_preview_range_create') {
          const frames = Number(args.range.endFrame) - Number(args.range.startFrame);
          const bytes = new Uint8Array(44 + frames * 4), view = new DataView(bytes.buffer);
          const text = (offset: number, value: string) => [...value].forEach((ch, i) => bytes[offset + i] = ch.charCodeAt(0));
          text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
          view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, 1000, true); view.setUint32(28, 4000, true);
          view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 4, true);
          previewBytes = Array.from(bytes);
          return { previewToken: 'preview:fixture', mimeType: 'audio/wav', byteLength: bytes.length, durationMillis: frames, expiresInSeconds: 120, truncated: false };
        }
        if (command === 'v2_audio_preview_read') return previewBytes;
        if (command === 'v2_asset_metadata_get') return { tags: [], note: '' };
        if (command === 'v2_change_recovery_status' || command === 'v2_rename_recovery_status') return {
          schema: command === 'v2_change_recovery_status' ? 'change-recovery-status:v1' : 'rename-recovery-status:v1', recoveryRequired: false, operations: [],
        };
        if (command === 'v2_clone_verification_status') return null;
        return [];
      },
    };
  });
});

test('browse, select exact detail, preview beyond 60 seconds and keep operations out of the browsing surface', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose root...' }).click();
  await expect(page.getByRole('dialog', { name: 'File operations' })).toBeHidden();
  await expect(page.locator('.catalog-library-file')).toHaveCount(100);
  await page.getByRole('button', { name: 'Break_000.wav SYNTHETIC_SET/AUDIO/Break_000.wav', exact: false }).click();
  await expect(page.getByRole('img', { name: 'Audio waveform', exact: true })).toBeVisible();
  await page.getByLabel('Selection start frame').fill('61000');
  await page.getByLabel('Selection end frame').fill('62000');
  await page.getByRole('button', { name: 'Set range', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom selection' }).click();
  await expect(page.getByRole('button', { name: 'Fit', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (window as any).__WF_CALLS__.filter((call: any) => call.command === 'v2_audio_waveform_query').at(-1).args.query.range)).toEqual({ startFrame: '61000', endFrame: '62000' });
  await page.getByLabel('Waveform channels').selectOption('right');
  await expect(page.locator('.waveform-preview-plot [data-channel="0"]')).toHaveCount(0);
  await expect(page.locator('.waveform-preview-plot [data-channel="1"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Load preview' }).click();
  await expect(page.getByLabel('Preview Break_000.wav')).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'File operations' })).toBeVisible();
  await page.getByRole('button', { name: 'Close operations' }).click();
  await expect(page.getByRole('dialog', { name: 'File operations' })).toBeHidden();
  await expect(page.getByLabel('Selection start frame')).toHaveValue('61000');
  await page.getByLabel('Search samples').fill('Break_229');
  await expect(page.locator('.catalog-library-file')).toHaveCount(1);
  await expect(page.getByLabel('Inspector')).not.toContainText('Break_000.wav');
  const commands = await page.evaluate(() => (window as any).__WF_CALLS__.map((call: any) => call.command));
  expect(commands.some((command: string) => /enable_write|_apply|_prepare|_authorize/.test(command))).toBe(false);
});

test('workspace remains usable on a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose root...' }).click();
  await page.locator('.catalog-library-file').first().click();
  await expect(page.getByRole('img', { name: 'Audio waveform', exact: true })).toBeVisible();
  await expect(page.getByLabel('Selection start frame')).toBeVisible();
  const overflow = await page.locator('.mo-app-shell').evaluate(element => element.scrollWidth > element.clientWidth + 1);
  expect(overflow).toBe(false);
});
