import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeApi, CloneApi, RenameApi, RootApi } from "../../api";
import { ThemeProvider } from "../../design-system/themes/ThemeProvider";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { tEn, tJa } from "../../i18n/testStrings";
import { renameOperatorApiStubs } from "../../test/renameApiStubs";
import {
  DEFAULT_MAIN_SPLIT_PERCENT,
  DEFAULT_SOURCES_SPLIT_PERCENT,
  PANE_SPLIT_STORAGE_KEY,
} from "./paneSplitStorage";
import { RootRegistryPanel } from "./RootRegistryPanel";

function fakeChangeApi(): ChangeApi {
  return {
    planAdditiveCopy: vi.fn(),
    getPlan: vi.fn(),
    applyChange: vi.fn(),
    changeStatus: vi.fn(),
    recoverChange: vi.fn(),
    recoveryStatus: vi.fn().mockResolvedValue({
      schema: "change-recovery-status:v1",
      recoveryRequired: false,
      operations: [],
    }),
  };
}

function fakeRenameApi(): RenameApi {
  return {
    plan: vi.fn(),
    getPlan: vi.fn(),
    authorize: vi.fn(),
    createBackup: vi.fn(),
    prepare: vi.fn(),
    getStatus: vi.fn(),
    recoveryStatus: vi.fn().mockResolvedValue({
      schema: "rename-recovery-status:v1",
      recoveryRequired: false,
      operations: [],
    }),
    ...renameOperatorApiStubs(),
  };
}

function fakeCloneApi(): CloneApi {
  return {
    recordSourceEvidence: vi.fn(),
    createManagedClone: vi.fn(),
    verifyExternal: vi.fn(),
    verificationStatus: vi.fn().mockResolvedValue(null),
    reverify: vi.fn(),
  };
}

const metadataClient = {
  loadManualAssetMetadata: vi.fn().mockResolvedValue({ tags: [], note: null }),
  replaceManualAssetMetadata: vi.fn(),
};

const audioClient = {
  queryWaveform: vi.fn().mockResolvedValue({
    analyzerVersion: "waveform:v2",
    sampleRate: 44100,
    channels: 2,
    frameCount: "1000",
    range: { startFrame: "0", endFrameExclusive: "1000" },
    framesPerPeak: "1",
    channelPeaks: [[{ min: -0.5, max: 0.5 }]],
  }),
  createPreviewToken: vi.fn(),
  createRangePreviewToken: vi.fn(),
  readPreview: vi.fn(),
  getWaveform: vi.fn(),
};

function renderWorkspace(api: RootApi) {
  return render(
    <LocaleProvider initialLocaleId="ja">
      <ThemeProvider>
        <RootRegistryPanel
          api={api}
          audioClient={audioClient}
          metadataClient={metadataClient}
          changeClient={fakeChangeApi()}
          cloneClient={fakeCloneApi()}
          renameClient={fakeRenameApi()}
          selectDirectory={vi.fn().mockResolvedValue("/tmp/fixture-root")}
        />
      </ThemeProvider>
    </LocaleProvider>,
  );
}

function catalogWorkspaceApi(): RootApi {
  return {
    registerRoot: vi.fn().mockResolvedValue({
      rootId: "root-opaque",
      displayName: "Fixture Root",
      deviceFingerprint: "0123456789abcdef",
      mode: "read_only",
      observedRevision: 1,
      expiresInSeconds: 3600,
      capabilities: { read: true, write: false, stableDeviceIdentity: true },
    }),
    rootStatus: vi.fn(),
    enableWrite: vi.fn(),
    disableWrite: vi.fn(),
    closeRoot: vi.fn(),
    listLibrary: vi.fn().mockResolvedValue({
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
      audioFiles: [
        {
          fileInstanceId: "fileinst:v1:pool",
          assetId: "asset:v1:pool",
          displayName: "POOL.wav",
          relativePath: "LIVE_SET/AUDIO/POOL.wav",
          byteSize: 2048,
          storageScope: "set_audio_pool",
        },
        {
          fileInstanceId: "fileinst:v1:project",
          assetId: "asset:v1:project",
          displayName: "PROJECT.wav",
          relativePath: "LIVE_SET/PROJECT_A/PROJECT.wav",
          byteSize: 4096,
          storageScope: "project_local",
        },
      ],
      usageEdges: [],
    }),
  };
}

function mockSplitRect(element: HTMLElement, width = 200) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    left: 0,
    width,
    top: 0,
    height: 100,
    right: width,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

describe("RootRegistryPanel workspace layout", () => {
  beforeEach(() => {
    window.localStorage.removeItem(PANE_SPLIT_STORAGE_KEY);
  });

  afterEach(() => {
    window.localStorage.removeItem(PANE_SPLIT_STORAGE_KEY);
  });

  it("updates the center list when a catalog location is selected in the left nav", async () => {
    const api: RootApi = {
      registerRoot: vi.fn().mockResolvedValue({
        rootId: "root-opaque",
        displayName: "Fixture Root",
        deviceFingerprint: "0123456789abcdef",
        mode: "read_only",
        observedRevision: 1,
        expiresInSeconds: 3600,
        capabilities: { read: true, write: false, stableDeviceIdentity: true },
      }),
      rootStatus: vi.fn(),
      enableWrite: vi.fn(),
      disableWrite: vi.fn(),
      closeRoot: vi.fn(),
      listLibrary: vi.fn().mockResolvedValue({
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
        audioFiles: [
          {
            fileInstanceId: "fileinst:v1:pool",
            assetId: "asset:v1:pool",
            displayName: "POOL.wav",
            relativePath: "LIVE_SET/AUDIO/POOL.wav",
            byteSize: 2048,
            storageScope: "set_audio_pool",
          },
          {
            fileInstanceId: "fileinst:v1:project",
            assetId: "asset:v1:project",
            displayName: "PROJECT.wav",
            relativePath: "LIVE_SET/PROJECT_A/PROJECT.wav",
            byteSize: 4096,
            storageScope: "project_local",
          },
        ],
        usageEdges: [],
      }),
    };

    renderWorkspace(api);
    fireEvent.click(screen.getByRole("button", { name: tJa("sources.chooseRoot") }));
    expect(await screen.findByText("POOL.wav")).toBeInTheDocument();

    const nav = screen.getByLabelText(tJa("workspace.navAria"));
    fireEvent.click(within(nav).getByRole("button", { name: "PROJECT_A" }));
    await waitFor(() => {
      expect(screen.getByText("PROJECT.wav")).toBeInTheDocument();
      expect(screen.queryByText("POOL.wav")).not.toBeInTheDocument();
    });
  });

  it("does not call listLibrary again when switching display language", async () => {
    const listLibrary = vi.fn().mockResolvedValue({
      sets: [{
        displayName: "LIVE_SET",
        relativePath: "LIVE_SET",
        hasAudioPool: true,
        projects: [],
      }],
      standaloneProjects: [],
      audioFiles: [{
        fileInstanceId: "fileinst:v1:pool",
        assetId: "asset:v1:pool",
        displayName: "POOL.wav",
        relativePath: "LIVE_SET/AUDIO/POOL.wav",
        byteSize: 2048,
        storageScope: "set_audio_pool",
      }],
      usageEdges: [],
    });
    const api: RootApi = {
      registerRoot: vi.fn().mockResolvedValue({
        rootId: "root-opaque",
        displayName: "Fixture Root",
        deviceFingerprint: "0123456789abcdef",
        mode: "read_only",
        observedRevision: 1,
        expiresInSeconds: 3600,
        capabilities: { read: true, write: false, stableDeviceIdentity: true },
      }),
      rootStatus: vi.fn(),
      enableWrite: vi.fn(),
      disableWrite: vi.fn(),
      closeRoot: vi.fn(),
      listLibrary,
    };

    renderWorkspace(api);
    fireEvent.click(screen.getByRole("button", { name: tJa("sources.chooseRoot") }));
    await screen.findByText("POOL.wav");
    expect(listLibrary).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText(tJa("language.selectAria")), {
      target: { value: "en" },
    });
    await waitFor(() => {
      expect(screen.getByText(tEn("workspace.navHeading"))).toBeInTheDocument();
    });
    expect(listLibrary).toHaveBeenCalledTimes(1);
  });

  it("opens expanded slice workspace from the inspector slice tab and returns to catalog", async () => {
    const listLibrary = vi.fn().mockResolvedValue({
      sets: [{
        displayName: "LIVE_SET",
        relativePath: "LIVE_SET",
        hasAudioPool: true,
        projects: [],
      }],
      standaloneProjects: [],
      audioFiles: [{
        fileInstanceId: "fileinst:v1:pool",
        assetId: "asset:v1:pool",
        displayName: "POOL.wav",
        relativePath: "LIVE_SET/AUDIO/POOL.wav",
        byteSize: 2048,
        storageScope: "set_audio_pool",
      }],
      usageEdges: [],
    });
    const api: RootApi = {
      registerRoot: vi.fn().mockResolvedValue({
        rootId: "root-opaque",
        displayName: "Fixture Root",
        deviceFingerprint: "0123456789abcdef",
        mode: "read_only",
        observedRevision: 1,
        expiresInSeconds: 3600,
        capabilities: { read: true, write: false, stableDeviceIdentity: true },
      }),
      rootStatus: vi.fn(),
      enableWrite: vi.fn(),
      disableWrite: vi.fn(),
      closeRoot: vi.fn(),
      listLibrary,
    };

    renderWorkspace(api);
    fireEvent.click(screen.getByRole("button", { name: tJa("sources.chooseRoot") }));
    fireEvent.click(await screen.findByText("POOL.wav"));
    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabSlice") }));
    expect(screen.getByRole("button", { name: tJa("slicing.detectAttacks") })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: tJa("inspector.expandSliceWorkspaceAria") }));
    expect(screen.getByTestId("slice-workspace-expanded-shell")).toBeInTheDocument();
    expect(screen.getByTestId("catalog-workspace-main-host")).toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: tJa("slicing.detectAttacks") })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: tJa("inspector.exitSliceWorkspaceAria") }));
    await waitFor(() => {
      expect(screen.queryByTestId("slice-workspace-expanded-shell")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("catalog-workspace-main-host")).not.toHaveAttribute("hidden");
  });

  it("moves list selection with arrows and focuses Top Bar search with Ctrl+F", async () => {
    const api: RootApi = {
      registerRoot: vi.fn().mockResolvedValue({
        rootId: "root-opaque",
        displayName: "Fixture Root",
        deviceFingerprint: "0123456789abcdef",
        mode: "read_only",
        observedRevision: 1,
        expiresInSeconds: 3600,
        capabilities: { read: true, write: false, stableDeviceIdentity: true },
      }),
      rootStatus: vi.fn(),
      enableWrite: vi.fn(),
      disableWrite: vi.fn(),
      closeRoot: vi.fn(),
      listLibrary: vi.fn().mockResolvedValue({
        sets: [{
          displayName: "LIVE_SET",
          relativePath: "LIVE_SET",
          hasAudioPool: true,
          projects: [],
        }],
        standaloneProjects: [],
        audioFiles: [
          {
            fileInstanceId: "fileinst:v1:kick",
            assetId: "asset:v1:kick",
            displayName: "KICK.wav",
            relativePath: "LIVE_SET/AUDIO/KICK.wav",
            byteSize: 2048,
            storageScope: "set_audio_pool",
          },
          {
            fileInstanceId: "fileinst:v1:snare",
            assetId: "asset:v1:snare",
            displayName: "SNARE.wav",
            relativePath: "LIVE_SET/AUDIO/SNARE.wav",
            byteSize: 4096,
            storageScope: "set_audio_pool",
          },
        ],
        usageEdges: [],
      }),
    };

    renderWorkspace(api);
    fireEvent.click(screen.getByRole("button", { name: tJa("sources.chooseRoot") }));
    const kick = await screen.findByText("KICK.wav");
    fireEvent.click(kick);
    const rows = screen.getAllByRole("row").filter((row) =>
      row.classList.contains("catalog-file-table__row"),
    );
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown" });
    await waitFor(() => {
      const nextRows = screen.getAllByRole("row").filter((row) =>
        row.classList.contains("catalog-file-table__row"),
      );
      expect(nextRows[1]).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText(tJa("library.searchAria")));
  });

  it("restores pane split percentages after resize and remount", async () => {
    const view = renderWorkspace(catalogWorkspaceApi());
    fireEvent.click(screen.getByRole("button", { name: tJa("sources.chooseRoot") }));
    expect(await screen.findByText("POOL.wav")).toBeInTheDocument();

    const sources = screen.getByTestId("app-shell-sources");
    expect(sources).toHaveStyle({ width: `${DEFAULT_SOURCES_SPLIT_PERCENT}%` });
    expect(document.querySelector(".mo-app-shell__main")).toHaveStyle({
      width: `${DEFAULT_MAIN_SPLIT_PERCENT}%`,
    });

    const outer = document.querySelector(".mo-app-shell__outer-split") as HTMLElement;
    mockSplitRect(outer);
    fireEvent.mouseDown(screen.getByTestId("app-shell-divider"));
    fireEvent.mouseMove(document, { clientX: 60 });
    fireEvent.mouseUp(document);
    expect(sources).toHaveStyle({ width: "30%" });

    const inner = document.querySelector(".mo-app-shell__inner-split") as HTMLElement;
    mockSplitRect(inner);
    fireEvent.mouseDown(screen.getByTestId("app-shell-inner-divider"));
    fireEvent.mouseMove(document, { clientX: 120 });
    fireEvent.mouseUp(document);
    expect(document.querySelector(".mo-app-shell__main")).toHaveStyle({ width: "60%" });

    view.unmount();

    renderWorkspace(catalogWorkspaceApi());
    fireEvent.click(screen.getByRole("button", { name: tJa("sources.chooseRoot") }));
    expect(await screen.findByText("POOL.wav")).toBeInTheDocument();
    expect(screen.getByTestId("app-shell-sources")).toHaveStyle({ width: "30%" });
    expect(document.querySelector(".mo-app-shell__main")).toHaveStyle({ width: "60%" });
  });

  it("falls back to default pane splits when stored JSON is corrupt", async () => {
    window.localStorage.setItem(PANE_SPLIT_STORAGE_KEY, "{not-json");
    renderWorkspace(catalogWorkspaceApi());
    fireEvent.click(screen.getByRole("button", { name: tJa("sources.chooseRoot") }));
    expect(await screen.findByText("POOL.wav")).toBeInTheDocument();
    expect(screen.getByTestId("app-shell-sources")).toHaveStyle({
      width: `${DEFAULT_SOURCES_SPLIT_PERCENT}%`,
    });
    expect(document.querySelector(".mo-app-shell__main")).toHaveStyle({
      width: `${DEFAULT_MAIN_SPLIT_PERCENT}%`,
    });
  });
});
