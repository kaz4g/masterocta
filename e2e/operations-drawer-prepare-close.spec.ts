import { test, expect } from "@playwright/test";
import { clickCatalogFileRow, openSampleRenameFromCatalog } from "./catalogFileRow";
import { uiText } from "./i18n";
import { expectEditEnabledInContextBar } from "./narrowWorkspace";
import { installDerivationIpcDefaults } from "./derivationIpcMocks";

const planId = `plan:v1:${"a".repeat(64)}`;
const operationId = `operation:v1:${"a".repeat(64)}`;
const authorityId = `authority:v1:${"b".repeat(64)}`;
const snapshotId = `snapshot:v1:${"c".repeat(64)}`;

test.describe("Operations Drawer close during prepare", () => {
  test("closing the drawer does not cancel an in-flight rename prepare", async ({ page }) => {
    await installDerivationIpcDefaults(page);
    await page.addInitScript(({ planId, operationId, authorityId, snapshotId }) => {
      (window as any).__E2E_ROOT_PATH__ = "/tmp/fixture-root";
      (window as any).__E2E_INVOKE_CALLS__ = [];
      let renamePrepareFinished = false;
      (window as any).__TAURI_INTERNALS__ = {
        transformCallback: () => {},
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          (window as any).__E2E_INVOKE_CALLS__ = [
            ...((window as any).__E2E_INVOKE_CALLS__ ?? []),
            cmd,
          ];
          if (cmd === "v2_root_register") {
            return {
              rootId: "root-opaque",
              displayName: "Fixture Root",
              deviceFingerprint: `rootfp:v1:${"f".repeat(64)}`,
              mode: "read_only",
              observedRevision: 1,
              expiresInSeconds: 3600,
              writeGrantExpiresInSeconds: null,
              capabilities: { read: true, write: true, stableDeviceIdentity: true },
            };
          }
          if (cmd === "v2_root_status" || cmd === "v2_root_enable_write") {
            return {
              rootId: "root-opaque",
              displayName: "Fixture Root",
              deviceFingerprint: `rootfp:v1:${"f".repeat(64)}`,
              mode: "write_enabled",
              observedRevision: 1,
              expiresInSeconds: 3600,
              writeGrantExpiresInSeconds: 600,
              capabilities: { read: true, write: true, stableDeviceIdentity: true },
            };
          }
          if (cmd === "v2_library_list") {
            return {
              sets: [{
                displayName: "LIVE_SET",
                relativePath: "LIVE_SET",
                hasAudioPool: true,
                projects: [{
                  displayName: "PROJECT_A",
                  relativePath: "LIVE_SET/PROJECT_A",
                  hasProjectFile: true,
                  hasBanks: true,
                }],
              }],
              standaloneProjects: [],
              audioFiles: [{
                fileInstanceId: `fileinst:v1:${"d".repeat(64)}`,
                assetId: `asset:v1:${"e".repeat(64)}`,
                displayName: "KICK.wav",
                relativePath: "LIVE_SET/AUDIO/KICK.wav",
                byteSize: 2048,
                storageScope: "set_audio_pool",
              }],
              usageEdges: [],
            };
          }
          if (cmd === "v2_change_recovery_status") {
            return {
              schema: "change-recovery-status:v1",
              recoveryRequired: false,
              operations: [],
            };
          }
          if (cmd === "v2_rename_recovery_status") {
            return {
              schema: "rename-recovery-status:v1",
              recoveryRequired: false,
              operations: renamePrepareFinished
                ? [{
                  schema: "rename-status:v1",
                  operationId,
                  planId,
                  state: "prepared",
                  backupSnapshotId: snapshotId,
                  failureCode: null,
                  planExpired: false,
                  recoveryEligible: false,
                }]
                : [],
            };
          }
          if (cmd === "v2_rename_plan" || cmd === "v2_rename_get_plan") {
            return {
              outcome: "planned",
              schema: "rename-plan:v1",
              planId,
              operationId,
              operation: "rename_sample",
              sourceFileInstanceId: `fileinst:v1:${"d".repeat(64)}`,
              sourceRelativePath: "LIVE_SET/AUDIO/KICK.wav",
              destinationRelativePath: "LIVE_SET/AUDIO/KICK_DEEP.wav",
              stateDocumentImpacts: [],
              usageEdgeImpacts: [],
              sidecarImpacts: [],
              backupRelativePaths: ["LIVE_SET/AUDIO/KICK.wav"],
              estimatedMediaAdditionalBytes: 2048,
              estimatedLocalStagingBytes: 4096,
              referenceUpdateCount: 1,
              warnings: [],
              requiresExplicitApproval: true,
              overwriteAllowed: false,
              removesSourceOnApply: true,
            };
          }
          if (cmd === "v2_rename_authorize") {
            return {
              schema: "rename-authority:v1",
              authorityId,
              planId,
              operationId,
              expiresInSeconds: 600,
            };
          }
          if (cmd === "v2_rename_create_backup") {
            return {
              schema: "rename-backup-status:v1",
              planId,
              snapshotId,
              state: "backup_verified",
              fileCount: 1,
              totalBytes: 2048,
              verified: true,
            };
          }
          if (cmd === "v2_rename_prepare") {
            await new Promise<void>((resolve) => {
              (window as any).__E2E_RELEASE_PREPARE__ = resolve;
            });
            renamePrepareFinished = true;
            return {
              schema: "rename-prepare-status:v1",
              planId,
              operationId,
              snapshotId,
              state: "prepared",
              stagedFileCount: 1,
              totalStagedBytes: 2048,
              projectRewriteCount: 0,
            };
          }
          if (cmd === "v2_rename_get_status") {
            return {
              schema: "rename-status:v1",
              operationId,
              planId,
              state: "prepared",
              backupSnapshotId: snapshotId,
              failureCode: null,
              planExpired: false,
              recoveryEligible: false,
            };
          }
          if (cmd === "v2_audio_get_waveform") {
            return {
              durationSeconds: 1,
              sampleRate: 44100,
              channels: 1,
              peaks: [{ min: -0.2, max: 0.4 }],
            };
          }
          if (cmd === "v2_metadata_load_manual_asset") {
            return { tags: [], note: "" };
          }
          const __derivationMock = (window as any).__MO_E2E_TRY_DERIVATION_IPC__?.(cmd, args ?? {});
          if (__derivationMock !== undefined) return __derivationMock;
          return null;
        },
      };
    }, { planId, operationId, authorityId, snapshotId });

    await page.goto("/");
    await page.getByRole("button", { name: uiText("ja", "sources.chooseRoot") }).click();
    await expect(page.getByText("PROJECT_A")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: uiText("ja", "sources.editMode") }).click();
    await expectEditEnabledInContextBar(page, "ja");
    await clickCatalogFileRow(page, "ja", "KICK.wav");
    await openSampleRenameFromCatalog(page, "ja");
    const renameDrawer = page.getByRole("dialog");
    await renameDrawer.getByLabel("New file name").fill("KICK_DEEP.wav");
    await renameDrawer.getByRole("button", { name: "Review Rename" }).click();
    await renameDrawer.getByRole("button", { name: "Approve & Prepare" }).click();

    await expect.poll(async () => {
      const calls = await page.evaluate(() => (window as any).__E2E_INVOKE_CALLS__ ?? []);
      return calls.includes("v2_rename_prepare");
    }).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const callsAfterClose = await page.evaluate(() => (window as any).__E2E_INVOKE_CALLS__ ?? []);
    expect(callsAfterClose.filter((cmd: string) => cmd === "v2_rename_prepare")).toHaveLength(1);
    expect(callsAfterClose.includes("v2_rename_apply")).toBe(false);
    expect(callsAfterClose.includes("v2_rename_recover")).toBe(false);
    expect(callsAfterClose.includes("v2_change_recover")).toBe(false);
    expect(callsAfterClose.some((cmd: string) => /cancel/i.test(cmd))).toBe(false);

    const openOperations = page.getByRole("button", {
      name: uiText("ja", "workspace.openOperationsAria"),
    });
    await expect(openOperations).toBeVisible();
    await openOperations.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const callsWhilePending = await page.evaluate(() => (window as any).__E2E_INVOKE_CALLS__ ?? []);
    expect(callsWhilePending.includes("v2_rename_apply")).toBe(false);
    expect(callsWhilePending.includes("v2_rename_recover")).toBe(false);
    expect(callsWhilePending.includes("v2_change_recover")).toBe(false);
    expect(callsWhilePending.some((cmd: string) => /cancel/i.test(cmd))).toBe(false);

    await page.evaluate(() => {
      const release = (window as any).__E2E_RELEASE_PREPARE__;
      if (typeof release === "function") release();
    });

    await expect(page.getByText(uiText("ja", "workspace.statusContinuation"))).toBeVisible();
    await expect.poll(async () => {
      const calls = await page.evaluate(() => (window as any).__E2E_INVOKE_CALLS__ ?? []);
      return calls.filter((cmd: string) => cmd === "v2_rename_recovery_status").length;
    }).toBeGreaterThan(
      callsWhilePending.filter((cmd: string) => cmd === "v2_rename_recovery_status").length,
    );

    const inspectorRename = page
      .getByTestId("inspector-workspace-host")
      .getByRole("button", { name: uiText("ja", "inspector.renameAction") });
    await expect(inspectorRename).toBeEnabled();
    await inspectorRename.click();
    const reopened = page.getByRole("dialog");
    await expect(reopened.getByText("Rename prepared")).toBeVisible();
    await expect(reopened.getByText("Status: PREPARED")).toBeVisible();
    await expect(reopened.getByText("KICK_DEEP.wav")).toBeVisible();
    await expect(reopened.getByText(/No Octatrack media changes have been applied/i)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await openOperations.click();
    const reopenedFromStatus = page.getByRole("dialog");
    await expect(reopenedFromStatus.getByText("PREPARED", { exact: true })).toBeVisible();
    await expect(reopenedFromStatus.getByText(operationId)).toBeVisible();

    const callsAfterReopen = await page.evaluate(() => (window as any).__E2E_INVOKE_CALLS__ ?? []);
    expect(callsAfterReopen.filter((cmd: string) => cmd === "v2_rename_prepare")).toHaveLength(1);
    expect(callsAfterReopen.includes("v2_rename_apply")).toBe(false);
    expect(callsAfterReopen.includes("v2_rename_recover")).toBe(false);
    expect(callsAfterReopen.includes("v2_change_recover")).toBe(false);
    expect(callsAfterReopen.some((cmd: string) => /cancel/i.test(cmd))).toBe(false);
  });
});
