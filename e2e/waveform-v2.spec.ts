import { test, expect } from '@playwright/test'

test.use({ channel: process.env.WAVEFORM_TEST_BROWSER_CHANNEL })

test('synthetic stereo waveform: resize, zoom, pan, selection, ranged playback and mono switch', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1560, height: 1100 })
  await page.addInitScript(() => {
    const rate = 8000, frames = rate * 120
    const tokens = new Map<string, ArrayBuffer>()
    let sequence = 0
    const value = (frame: number, channel: number) => {
      const seconds = frame / rate
      const envelope = seconds < 15 ? Math.exp(-(seconds % .5) * 18) : seconds < 45 ? .5 : seconds < 60 ? 0 : seconds < 90 ? Math.exp(-(seconds % 1) * 9) : .25
      return Math.sin(frame * (channel ? .091 : .07)) * envelope * (channel ? .6 : 1)
    }
    const root = { rootId: 'root-fixture', displayName: 'Synthetic waveform fixture', deviceFingerprint: 'fixture-only', mode: 'read_only', observedRevision: 1, expiresInSeconds: 3600, writeGrantExpiresInSeconds: null, capabilities: { read: true, write: false, stableDeviceIdentity: false } }
    const files = ['Stereo.wav', 'Mono.wav'].map((name, i) => ({ fileInstanceId: `file-${i}`, assetId: `asset-${i}`, displayName: name, relativePath: `SYNTHETIC/AUDIO/${name}`, byteSize: frames * 4 + 44, storageScope: 'set_audio_pool' }))
    const snapshot = { sets: [{ displayName: 'SYNTHETIC', relativePath: 'SYNTHETIC', hasAudioPool: true, projects: [] }], standaloneProjects: [], audioFiles: files, usageEdges: [] }
    const calls: Array<{ command: string; args: any }> = []
    ;(window as any).__waveformCalls = calls
    ;(window as any).__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (command: string, args: any) => {
        calls.push({ command, args })
        if (command === 'plugin:dialog|open') return '/synthetic-test-root'
        if (command === 'v2_root_register') return root
        if (command === 'v2_library_list') return snapshot
        if (command === 'v2_change_recovery_status') return { recoveryRequired: false, operations: [] }
        if (command === 'v2_asset_metadata_get') return { tags: [], note: '' }
        if (command === 'v2_audio_waveform_prepare') return { state: 'READY', metadata: { sampleRate: rate, channelCount: args.assetId === 'asset-1' ? 1 : 2, totalFrames: frames }, errorCode: null }
        if (command === 'v2_audio_waveform_query') {
          const q = args.query, count = args.assetId === 'asset-1' ? 1 : 2
          const boundaries = Array.from({ length: q.targetPoints + 1 }, (_, i) => q.startFrame + Math.floor((q.endFrameExclusive - q.startFrame) * i / q.targetPoints))
          return { schema: 'waveform-query:v2', analyzerVersion: 'waveform:v2', sampleRate: rate, channelCount: count, totalFrames: frames, range: { startFrame: q.startFrame, endFrameExclusive: q.endFrameExclusive }, bucketBoundaries: boundaries,
            channels: Array.from({ length: count }, (_, channelIndex) => ({ channelIndex, peaks: boundaries.slice(1).map((end, i) => {
              let min = 1, max = -1, squares = 0
              for (let f = boundaries[i]; f < end; f++) { const x = value(f, channelIndex); min = Math.min(min, x); max = Math.max(max, x); squares += x * x }
              return { min, max, rms: Math.sqrt(squares / (end - boundaries[i])), frameCount: end - boundaries[i] }
            }) })) }
        }
        if (command === 'v2_audio_preview_range_create') {
          const start = args.range.startFrame, end = Math.min(args.range.endFrameExclusive, start + rate * 60), count = args.assetId === 'asset-1' ? 1 : 2
          const bytes = new ArrayBuffer(44 + (end - start) * count * 2), view = new DataView(bytes)
          const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)) }
          text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true); view.setUint32(24, rate, true); view.setUint32(28, rate * count * 2, true); view.setUint16(32, count * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes.byteLength - 44, true)
          let offset = 44
          for (let f = start; f < end; f++) for (let c = 0; c < count; c++) { view.setInt16(offset, Math.round(value(f, c) * 32767), true); offset += 2 }
          const token = `test-preview-${++sequence}`; tokens.set(token, bytes)
          return { previewToken: token, expiresInSeconds: 120, mimeType: 'audio/wav', byteLength: bytes.byteLength, durationMillis: (end - start) * 1000 / rate, range: { startFrame: start, endFrameExclusive: end }, sampleRate: rate, truncated: end < args.range.endFrameExclusive, truncationReason: end < args.range.endFrameExclusive ? 'durationLimit' : null }
        }
        if (command === 'v2_audio_preview_read') { const bytes = tokens.get(args.previewToken); tokens.delete(args.previewToken); if (!bytes) throw new Error('Consumed'); return bytes }
        return null
      },
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Choose root...' }).click()
  await page.getByRole('button', { name: /Stereo.wav/ }).click()
  const waveform = page.getByRole('img', { name: /independent L and R/ })
  await expect(waveform).toBeVisible()
  const section = page.getByRole('region', { name: 'Waveform preview for Stereo.wav' })
  await section.screenshot({ path: testInfo.outputPath('waveform-stereo.png') })
  const firstWidth = await waveform.getAttribute('width')
  await page.setViewportSize({ width: 1800, height: 1100 })
  await expect.poll(async () => page.getByRole('img', { name: /independent L and R/ }).getAttribute('width')).not.toBe(firstWidth)
  const plot = page.getByRole('group', { name: 'Waveform navigation' })
  const box = (await plot.boundingBox())!
  await page.mouse.move(box.x + box.width * .7, box.y + 90)
  await page.mouse.wheel(0, -500)
  await expect.poll(() => page.evaluate(() => (window as any).__waveformCalls.filter((c: any) => c.command === 'v2_audio_waveform_query').at(-1).args.query.startFrame)).toBeGreaterThan(0)
  await page.keyboard.down('Shift'); await page.mouse.wheel(0, 90); await page.keyboard.up('Shift')
  await expect(waveform).toBeVisible()
  await plot.focus(); await page.keyboard.press('f'); await expect(waveform).toBeVisible()
  await page.mouse.move(box.x + box.width * .65, box.y + 90); await page.mouse.down(); await page.mouse.move(box.x + box.width * .8, box.y + 90, { steps: 6 }); await page.mouse.up()
  await expect(section).toContainText('Selection [')
  await section.getByRole('button', { name: 'Load selection preview' }).click()
  await expect(section.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
  const previewStart = await page.evaluate(() => (window as any).__waveformCalls.filter((c: any) => c.command === 'v2_audio_preview_range_create').at(-1).args.range.startFrame)
  expect(previewStart).toBeGreaterThan(8000 * 60)
  await section.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(section.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await expect.poll(() => section.locator('.waveform-readout').innerText()).not.toContain(`Frame ${previewStart} ·`)
  await section.screenshot({ path: testInfo.outputPath('waveform-selection.png') })
  await page.getByRole('button', { name: /Mono.wav/ }).click()
  await expect(page.getByRole('img', { name: 'Mono audio waveform' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled()
  await expect(page.getByRole('region', { name: 'Waveform preview for Mono.wav' }).locator('.waveform-readout')).toContainText('Frame 0 · 0.000s')
  await page.getByRole('region', { name: 'Waveform preview for Mono.wav' }).screenshot({ path: testInfo.outputPath('waveform-mono.png') })
})
