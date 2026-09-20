import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/derivations", () => ({
  derivationsApi: {
    getAssetDerivation: vi.fn().mockResolvedValue({
      assetId: "asset:v1:pool",
      isDerived: false,
      derivation: null,
    }),
    listDerivedChildren: vi.fn().mockResolvedValue({
      assetId: "asset:v1:pool",
      children: [],
    }),
  },
}));
import type { LibraryAudioFile, LibrarySnapshot } from "../../api";
import { derivationsApi } from "../../api/derivations";
import { tJa } from "../../i18n/testStrings";
import { InspectorTabbedAssetPanel } from "./InspectorTabbedAssetPanel";

const file: LibraryAudioFile = {
  fileInstanceId: "fileinst:v1:pool",
  assetId: "asset:v1:pool",
  displayName: "POOL.wav",
  relativePath: "LIVE_SET/AUDIO/POOL.wav",
  byteSize: 2048,
  storageScope: "set_audio_pool",
};

const snapshot: LibrarySnapshot = {
  sets: [],
  standaloneProjects: [],
  audioFiles: [file],
  usageEdges: [],
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

const metadataClient = {
  loadManualAssetMetadata: vi.fn().mockResolvedValue({ tags: [], note: null }),
  replaceManualAssetMetadata: vi.fn(),
};

const panelProps = {
  rootId: "root-opaque",
  snapshot,
  audioClient,
  metadataClient,
  geometrySelectionGeneration: 1,
  librarySelectionRange: null,
  stopPlaybackToken: 0,
  renameRecovery: null,
  renameBlocked: true,
  copyBlocked: true,
  renameBusy: false,
  writeEnabled: false,
  onRename: vi.fn(),
  onCopy: vi.fn(),
  onCommittedGeometryRangeChange: vi.fn(),
  onRequestStopLibraryPlayback: vi.fn(),
} satisfies Omit<
  import("./InspectorTabbedAssetPanel").InspectorTabbedAssetPanelProps,
  "file"
>;

describe("InspectorTabbedAssetPanel", () => {
  beforeEach(() => {
    vi.mocked(derivationsApi.getAssetDerivation).mockClear();
    vi.mocked(derivationsApi.listDerivedChildren).mockClear();
    audioClient.queryWaveform.mockClear();
  });

  it("does not query lineage while Preview, Slice, Usage, or Notes is active", async () => {
    const { rerender } = render(
      <InspectorTabbedAssetPanel {...panelProps} file={file} />,
    );
    await waitFor(() => expect(audioClient.queryWaveform).toHaveBeenCalled());
    expect(derivationsApi.getAssetDerivation).not.toHaveBeenCalled();
    expect(derivationsApi.listDerivedChildren).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabSlice") }));
    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabUsage") }));
    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabNotes") }));
    const otherFile: LibraryAudioFile = { ...file, assetId: "asset:v1:other", displayName: "OTHER.wav" };
    rerender(<InspectorTabbedAssetPanel {...panelProps} file={otherFile} />);
    expect(derivationsApi.getAssetDerivation).not.toHaveBeenCalled();
    expect(derivationsApi.listDerivedChildren).not.toHaveBeenCalled();
  });

  it("queries lineage only after switching to Info, and not after leaving Info", async () => {
    const { rerender } = render(
      <InspectorTabbedAssetPanel {...panelProps} file={file} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabInfo") }));
    await waitFor(() => expect(derivationsApi.getAssetDerivation).toHaveBeenCalledTimes(1));
    expect(derivationsApi.listDerivedChildren).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabPreview") }));
    const nextFile: LibraryAudioFile = { ...file, assetId: "asset:v1:next", displayName: "NEXT.wav" };
    rerender(<InspectorTabbedAssetPanel {...panelProps} file={nextFile} />);
    expect(derivationsApi.getAssetDerivation).toHaveBeenCalledTimes(1);
    expect(derivationsApi.listDerivedChildren).toHaveBeenCalledTimes(1);
  });

  it("queries the newly selected asset while Info is active", async () => {
    const { rerender } = render(
      <InspectorTabbedAssetPanel {...panelProps} file={file} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabInfo") }));
    await waitFor(() => expect(derivationsApi.getAssetDerivation).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:pool",
    ));
    const nextFile: LibraryAudioFile = { ...file, assetId: "asset:v1:next", displayName: "NEXT.wav" };
    rerender(<InspectorTabbedAssetPanel {...panelProps} file={nextFile} />);
    await waitFor(() => expect(derivationsApi.getAssetDerivation).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:next",
    ));
  });

  it("switches tabs without remounting waveform query on tab change alone", async () => {
    render(
      <InspectorTabbedAssetPanel
        rootId="root-opaque"
        file={file}
        snapshot={snapshot}
        audioClient={audioClient}
        metadataClient={metadataClient}
        geometrySelectionGeneration={1}
        librarySelectionRange={null}
        stopPlaybackToken={0}
        renameRecovery={null}
        renameBlocked
        copyBlocked
        renameBusy={false}
        writeEnabled={false}
        onRename={vi.fn()}
        onCopy={vi.fn()}
        onCommittedGeometryRangeChange={vi.fn()}
        onRequestStopLibraryPlayback={vi.fn()}
      />,
    );

    await waitFor(() => expect(audioClient.queryWaveform).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabSlice") }));
    expect(screen.getByRole("tab", { name: tJa("inspector.tabSlice") })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabPreview") }));
    expect(audioClient.queryWaveform).toHaveBeenCalledTimes(1);
  });

  it("keeps notes editor mounted while another tab is visible", async () => {
    render(
      <InspectorTabbedAssetPanel
        rootId="root-opaque"
        file={file}
        snapshot={snapshot}
        audioClient={audioClient}
        metadataClient={metadataClient}
        geometrySelectionGeneration={1}
        librarySelectionRange={null}
        stopPlaybackToken={0}
        renameRecovery={null}
        renameBlocked
        copyBlocked
        renameBusy={false}
        writeEnabled={false}
        onRename={vi.fn()}
        onCopy={vi.fn()}
        onCommittedGeometryRangeChange={vi.fn()}
        onRequestStopLibraryPlayback={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabNotes") }));
    const note = await screen.findByLabelText(tJa("metadata.noteAria"));
    fireEvent.change(note, { target: { value: "keep me" } });

    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabInfo") }));
    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabNotes") }));
    expect(screen.getByLabelText(tJa("metadata.noteAria"))).toHaveValue("keep me");
  });
});
