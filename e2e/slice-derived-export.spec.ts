import { test, expect } from "@playwright/test";
import { clickCatalogFileRow } from "./catalogFileRow";
import { uiText } from "./i18n";

async function seedSliceExportFixture(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const source = window as any;
    source.__E2E_ROOT_PATH__ = "/tmp/synthetic-slice-export-root";
    const range = { startFrame: "0", endExclusive: "44100" };
    let revision = 0;
    let markers: any[] = [];
    let derivedChildren: any[] = [];
    const draft = () => ({
      revision,
      region: range,
      markers,
      canUndo: false,
      canRedo: false,
    });
    source.__E2E_SLICE_CALLS__ = [];
    source.__TAURI_INTERNALS__ = {
      transformCallback: () => {},
      invoke: async (cmd: string, args: any = {}) => {
        source.__E2E_SLICE_CALLS__.push({ cmd, args });
        if (cmd === "v2_root_register" || cmd === "v2_root_status") {
          return {
            rootId: "root-slice-export",
            displayName: "Synthetic slice export",
            deviceFingerprint: `rootfp:v1:${"b".repeat(64)}`,
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
            audioFiles: [{
              fileInstanceId: "file-slice-export",
              assetId: "asset-slice-export",
              displayName: "RANGE.wav",
              relativePath: "DRUMS/AUDIO/RANGE.wav",
              byteSize: 88244,
              storageScope: "set_audio_pool",
            }],
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
        if (cmd === "v2_audio_onsets_start") {
          return {
            jobId: "job-slice-export",
            phase: "ready",
            error: null,
            sampleRate: 44100,
            channels: 1,
            frameCount: "44100",
            region: range,
          };
        }
        if (cmd === "v2_slice_draft_get") return draft();
        if (cmd === "v2_audio_waveform_range_get") {
          return { range: args.range, peaks: [[[-0.5, 0.5]]] };
        }
        if (cmd === "v2_slice_proposal_create") {
          return {
            proposalId: `proposal-${revision}`,
            expectedRevision: revision,
            candidateCount: 1,
            suppressedCount: 0,
            exceedsDraftLimit: false,
            candidates: [{
              candidateId: "candidate-range",
              noveltyPeakFrame: "11025",
              estimatedAttackFrame: "11025",
              suggestedStartFrame: "11025",
              strength: 0.8,
              bandScores: [5, 4, 3],
              thresholdMargin: 2,
              uncertainty: { startFrame: "11025", endExclusive: "11026" },
              warnings: [],
            }],
          };
        }
        if (cmd === "v2_slice_draft_update" && args.edit?.kind === "acceptProposal") {
          revision = 1;
          markers = [{
            markerId: "candidate-range",
            startFrame: "11025",
            endExclusive: "44100",
            locked: false,
            manual: false,
          }];
          return draft();
        }
        if (cmd === "v2_slice_export_apply") {
          derivedChildren = [{
            assetId: "asset-derived-range",
            kind: "SLICE_EXPORT",
            parentAssetId: "asset-slice-export",
            parentAvailable: true,
            processor: { name: "masterocta-trim", revision: "pcm-wav-v1" },
            createdAt: "2026-09-21T00:00:00.000Z",
            parameters: {
              status: "available",
              startFrame: "11025",
              endFrameExclusive: "44100",
            },
          }];
          return {
            derivedAssetId: "asset-derived-range",
            sourceUnchanged: false,
            startFrame: "11025",
            endExclusive: "44100",
          };
        }
        if (cmd === "v2_asset_derivation_get") {
          return {
            assetId: args.assetId,
            isDerived: false,
            derivation: null,
          };
        }
        if (cmd === "v2_asset_derivation_list_children") {
          return { assetId: args.assetId, children: derivedChildren };
        }
        return null;
      },
    };
  });
}

test.describe("slice derived export", () => {
  test("RANGE.wav: select slice, confirm export, show opaque asset id", async ({ page }) => {
    await seedSliceExportFixture(page);
    await page.goto("/");
    await page.getByRole("button", { name: uiText("ja", "sources.chooseRoot") }).click();
    await clickCatalogFileRow(page, "ja", "RANGE.wav");
    await page.getByRole("tab", { name: uiText("ja", "inspector.tabSlice") }).click();
    await page.getByRole("button", { name: uiText("ja", "slicing.detectAttacks") }).click();
    await expect(page.getByRole("button", { name: uiText("ja", "slicing.applyCandidates") })).toBeEnabled();
    await page.getByRole("button", { name: uiText("ja", "slicing.applyCandidates") }).click();
    await page.getByRole("textbox", { name: "Start frame candidate-range" }).focus();
    await page.getByRole("button", { name: uiText("ja", "slicing.exportDerived") }).click();
    await page.getByRole("button", { name: uiText("ja", "slicing.exportDerivedConfirm") }).click();
    await expect(page.getByTestId("slice-export-success")).toContainText("asset-derived-range");
    const calls = await page.evaluate(() => (window as any).__E2E_SLICE_CALLS__);
    const exportCall = calls.find((entry: { cmd: string }) => entry.cmd === "v2_slice_export_apply");
    expect(exportCall?.args).toMatchObject({
      markerId: "candidate-range",
      expectedRevision: 1,
      fileInstanceId: "file-slice-export",
    });
    expect(exportCall?.args.range).toBeUndefined();
    await page.getByRole("tab", { name: uiText("ja", "inspector.tabInfo") }).click();
    await expect(page.getByTestId("inspector-derivation-children")).toBeVisible();
    await expect(page.getByText(uiText("ja", "inspector.derivationKind.SLICE_EXPORT"))).toBeVisible();
    await expect(page.getByText("asset-derived-range")).toBeVisible();
    const pageText = await page.locator(".mo-inspector-derivation").innerText();
    expect(pageText).not.toMatch(/sha256:/);
    expect(pageText).not.toContain("/tmp/");
  });
});
