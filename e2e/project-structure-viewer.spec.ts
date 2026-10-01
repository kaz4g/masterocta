import { test, expect } from '@playwright/test';
import { uiText } from './i18n';

for (const width of [1280, 840]) {
  test(`Project Structure read-only navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('masterocta.ui-locale', 'ja');
      (window as any).__E2E_ROOT_PATH__ = '/tmp/synthetic-pse-root';
      (window as any).__PSE_COMMANDS__ = [];
      (window as any).__TAURI_INTERNALS__ = {
        transformCallback: () => 0,
        invoke: async (command: string, args: any = {}) => {
          (window as any).__PSE_COMMANDS__.push({ command, args });
          if (command === 'v2_root_register' || command === 'v2_root_status') return { rootId: 'root-opaque', displayName: 'Synthetic fixture', deviceFingerprint: 'fixture', mode: 'read_only', observedRevision: 1, expiresInSeconds: 3600, capabilities: { read: true, write: false, stableDeviceIdentity: true } };
          if (command === 'v2_library_list') return { sets: [], standaloneProjects: [{ displayName: 'PSE_PROJECT', relativePath: 'PSE_PROJECT', hasProjectFile: true, hasBanks: true }], audioFiles: [], usageEdges: [] };
          if (command === 'v2_change_recovery_status' || command === 'v2_rename_recovery_status') return { schema: command, recoveryRequired: false, operations: [] };
          if (command === 'v2_clone_verification_status') return null;
          if (command === 'v2_project_structure_read') return {
            schema: 'masterocta.project-structure:v3', projectRelativePath: args.projectRelativePath, projectState: null,
            banks: ['working', 'savedCheckpoint'].map((role, i) => ({ index: 0, letter: 'A', role, sourceRelativePath: `PSE_PROJECT/bank01.${i === 0 ? 'work' : 'strd'}`, parseStatus: i === 0 ? 'parsed' : 'malformed', unmodeledDependencies: ['scenes'], patterns: [{ index: 0, partIndex: 0, scale: { kind: 'perTrack', masterLength: { kind: 'infinite' }, masterScale: { kind: 'times1' }, tracks: [{ track: 0, length: 12, scale: { kind: 'times1Over2' } }] } }], parts: [{ index: 0, tracks: [{ index: 0, playback: { kind: 'audio', machine: { kind: 'static' }, slot: { kind: 'slot', slotKind: 'static', number: 3 } } }, { index: 7, playback: { kind: 'master' } }] }] })),
          };
          throw new Error(`Unexpected fixture IPC: ${command}`);
        },
      };
    });
    await page.goto('/');
    await page.getByRole('button', { name: uiText('ja', 'sources.chooseRoot') }).click();
    // Open Sources when the responsive shell initially collapses navigation.
    const toggle = page.getByTestId('app-shell-context').getByRole('button', { name: uiText('ja', 'workspace.toggleNav') });
    if (width === 840 && await toggle.isVisible()) await toggle.click();
    await page.locator('.catalog-location-nav__location-btn').filter({ hasText: 'PSE_PROJECT' }).click();
    if (width === 840) await page.keyboard.press('Escape');
    const viewer = page.getByRole('region', { name: uiText('ja', 'pse.title') });
    await expect(viewer.getByRole('table')).toBeVisible();
    await expect(viewer).toContainText('Static 3');
    await expect(viewer).toContainText('Master');
    await expect(viewer).toContainText('INF');
    await expect(viewer).toContainText(uiText('ja', 'pse.deferred'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await viewer.getByText('Master', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`pse-${width}.png`), fullPage: true });
    await viewer.getByLabel('Bank', { exact: true }).selectOption('PSE_PROJECT/bank01.strd');
    await expect(viewer.getByRole('table')).toHaveCount(0);
    await expect(viewer).toContainText(uiText('ja', 'pse.unavailable'));
    const commands = await page.evaluate(() => (window as any).__PSE_COMMANDS__);
    const reads = commands.filter((c: any) => c.command === 'v2_project_structure_read');
    expect(reads.length).toBeGreaterThan(0);
    // React StrictMode may perform two reads; both must use the same bounded target.
    for (const read of reads) expect(read.args).toEqual({ rootId: 'root-opaque', projectRelativePath: 'PSE_PROJECT' });
    expect(commands.some((c: any) => /apply|enable_write|copy|move|swap/.test(c.command))).toBe(false);
  });
}
