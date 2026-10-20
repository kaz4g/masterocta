import { test, expect } from "@playwright/test";
import { catalogFileRowLocator, clickCatalogFileRow } from "./catalogFileRow";
import { uiText } from "./i18n";
import { LOCALE_STORAGE_KEY } from "../src/i18n/registry";
import { installDerivationIpcDefaults } from "./derivationIpcMocks";

async function installLibraryKeyboardMocks(page: import("@playwright/test").Page) {
  await installDerivationIpcDefaults(page);
  return page.addInitScript(() => {
    const source = window as any;
    source.__E2E_ROOT_PATH__ = "/tmp/synthetic-library-keyboard-root";
    source.__E2E_KEYBOARD_CALLS__ = [];
    source.__TAURI_INTERNALS__ = {
      transformCallback: () => {},
      invoke: async (cmd: string, args: any = {}) => {
        source.__E2E_KEYBOARD_CALLS__.push({ cmd, args });
        if (cmd === "v2_root_register" || cmd === "v2_root_status") {
          return {
            rootId: "root-keyboard",
            displayName: "Synthetic library keyboard",
            deviceFingerprint: `rootfp:v1:${"c".repeat(64)}`,
            mode: "read_only",
            observedRevision: 1,
            expiresInSeconds: 3600,
            writeGrantExpiresInSeconds: null,
            capabilities: { read: true, write: true, stableDeviceIdentity: true },
          };
        }
        if (cmd === "v2_library_list") {
          return {
            sets: [{ displayName: "DRUMS", relativePath: "DRUMS", hasAudioPool: true, projects: [] }],
            standaloneProjects: [],
            usageEdges: [],
            audioFiles: [
              {
                fileInstanceId: "file-kick",
                assetId: "asset-kick",
                displayName: "KICK.wav",
                relativePath: "DRUMS/AUDIO/KICK.wav",
                byteSize: 2048,
                storageScope: "set_audio_pool",
              },
              {
                fileInstanceId: "file-snare",
                assetId: "asset-snare",
                displayName: "SNARE.wav",
                relativePath: "DRUMS/AUDIO/SNARE.wav",
                byteSize: 4096,
                storageScope: "set_audio_pool",
              },
            ],
          };
        }
        if (cmd === "v2_change_recovery_status" || cmd === "v2_rename_recovery_status") {
          return { recoveryRequired: false, operations: [] };
        }
        if (cmd === "v2_asset_metadata_get") return { tags: [], note: "" };
        if (cmd === "v2_audio_waveform_query") {
          return {
            analyzerVersion: "waveform:v2",
            sampleRate: 44100,
            channels: 1,
            frameCount: "44100",
            range: { startFrame: "0", endFrameExclusive: "44100" },
            framesPerPeak: "256",
            channelPeaks: [[{ min: -0.5, max: 0.5 }]],
          };
        }
        if (cmd === "v2_audio_preview_create") {
          return {
            previewToken: "preview:v1:head",
            expiresInSeconds: 120,
            mimeType: "audio/wav",
            byteLength: 4,
            durationMillis: 1000,
            truncated: false,
          };
        }
        if (cmd === "v2_audio_preview_read") {
          return new Uint8Array([82, 73, 70, 70]).buffer;
        }
        const __derivationMock = (window as any).__MO_E2E_TRY_DERIVATION_IPC__?.(cmd, args ?? {});
        if (__derivationMock !== undefined) return __derivationMock;
        return null;
      },
    };
  });
}

test.describe("Library keyboard (synthetic IPC)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("moves selection, focuses search with Ctrl+F, and plays preview with Space", async ({ page }) => {
    await page.addInitScript(
      ([storageKey, localeId]) => {
        localStorage.setItem(storageKey, localeId);
      },
      [LOCALE_STORAGE_KEY, "ja"] as const,
    );
    await installLibraryKeyboardMocks(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: uiText("ja", "sources.chooseRoot") }).click();

    await clickCatalogFileRow(page, "ja", "KICK.wav");
    await expect(catalogFileRowLocator(page, "ja", "KICK.wav")).toHaveAttribute("aria-selected", "true");
    await catalogFileRowLocator(page, "ja", "KICK.wav").focus();
    await page.keyboard.press("ArrowDown");
    await expect(catalogFileRowLocator(page, "ja", "SNARE.wav")).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Control+f");
    await expect(page.getByRole("searchbox", { name: uiText("ja", "library.searchAria") })).toBeFocused();

    await catalogFileRowLocator(page, "ja", "SNARE.wav").focus();
    await page.keyboard.press("Space");
    await expect.poll(async () => page.evaluate(() => {
      const calls = (window as any).__E2E_KEYBOARD_CALLS__ ?? [];
      return calls.some((entry: any) => entry.cmd === "v2_audio_preview_create");
    })).toBe(true);
  });
});
