import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SliceApi, SliceDraft, SliceJob, SliceProposal } from "../../api/slices";
import { SliceWorkbench } from "./SliceWorkbench";

const region = { startFrame: "0", endExclusive: "44100" };
const ready: SliceJob = { jobId: "job-1", phase: "ready", error: null, sampleRate: 44100, channels: 1, frameCount: "44100", region };
const empty: SliceDraft = { revision: 0, region, markers: [], canUndo: false, canRedo: false };
const proposal: SliceProposal = {
  proposalId: "proposal-1", expectedRevision: 0, candidateCount: 1, suppressedCount: 0, exceedsDraftLimit: false,
  candidates: [{ candidateId: "candidate-1", noveltyPeakFrame: "990", estimatedAttackFrame: "1000", suggestedStartFrame: "956", strength: 0.7, bandScores: [4, 5, 3], thresholdMargin: 2, uncertainty: { startFrame: "950", endExclusive: "1050" }, warnings: [] }],
};
function client(): SliceApi {
  return {
    start: vi.fn().mockResolvedValue(ready), status: vi.fn().mockResolvedValue(ready), cancel: vi.fn().mockResolvedValue(undefined),
    draft: vi.fn().mockResolvedValue(empty), propose: vi.fn().mockResolvedValue(proposal),
    edit: vi.fn().mockResolvedValue({ ...empty, revision: 1, canUndo: true, markers: [{ markerId: "candidate-1", startFrame: "956", endExclusive: "44100", manual: false, locked: false }] }),
    waveform: vi.fn().mockResolvedValue({ range: region, peaks: [[[-0.5, 0.5]]] }),
    preview: vi.fn(), readPreview: vi.fn(),
  };
}
function mount(api: SliceApi) {
  return render(<SliceWorkbench rootId="root-1" fileInstanceId="file-1" displayName="loop.wav" api={api} />);
}
async function detect() {
  fireEvent.click(screen.getByRole("button", { name: "Detect attacks" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply candidates to draft" })).toBeEnabled());
}

describe("attack slicing workbench", () => {
  it("requires explicit analysis and candidate acceptance before saving a draft", async () => {
    const api = client(); mount(api);
    expect(api.start).not.toHaveBeenCalled();
    await detect();
    expect(api.start).toHaveBeenCalledWith("root-1", "file-1", undefined);
    expect(api.edit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply candidates to draft" }));
    await waitFor(() => expect(api.edit).toHaveBeenCalledWith("root-1", "job-1", 0, { kind: "acceptProposal", proposalId: "proposal-1" }));
    expect(await screen.findByDisplayValue("956")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });
  it("reuses the analysis for parameter changes without saving automatically", async () => {
    const api = client(); mount(api); await detect();
    fireEvent.change(screen.getByLabelText("Pre-roll (ms)"), { target: { value: "2" } });
    await waitFor(() => expect(api.propose).toHaveBeenLastCalledWith("root-1", "job-1", 0, expect.objectContaining({ preRollUs: 2000 })));
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(api.edit).not.toHaveBeenCalled();
  });
  it("shows empty detection and refuses to silently truncate an oversized proposal", async () => {
    const api = client(); vi.mocked(api.propose).mockResolvedValue({ ...proposal, candidateCount: 0, candidates: [] });
    mount(api); await detect();
    expect(screen.getByText(/No attacks found/)).toBeInTheDocument();
    expect(api.edit).not.toHaveBeenCalled();
    vi.mocked(api.propose).mockResolvedValue({ ...proposal, candidateCount: 4100, exceedsDraftLimit: true });
    fireEvent.change(screen.getByLabelText("Pre-roll (ms)"), { target: { value: "2" } });
    expect(await screen.findByText(/Only the first 4096 are displayed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply candidates to draft" })).toBeDisabled();
  });
  it("cancels a late start when the selected file changes and never publishes that result", async () => {
    const api = client(); let finish!: (job: SliceJob) => void;
    vi.mocked(api.start).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const screenView = mount(api);
    fireEvent.click(screen.getByRole("button", { name: "Detect attacks" }));
    screenView.rerender(<SliceWorkbench rootId="root-1" fileInstanceId="file-2" displayName="other.wav" api={api} />);
    finish(ready);
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith("root-1", "job-1"));
    expect(api.draft).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Apply candidates to draft" })).not.toBeInTheDocument();
  });
  it("reloads conflicts without replaying the user's edit", async () => {
    const api = client();
    vi.mocked(api.edit).mockRejectedValue({ code: "DRAFT_CONFLICT", message: "The draft changed; reload it before editing." });
    mount(api); await detect();
    vi.mocked(api.draft).mockResolvedValue({ ...empty, revision: 4 });
    fireEvent.click(screen.getByRole("button", { name: "Apply candidates to draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The draft changed");
    await waitFor(() => expect(screen.getByText(/revision 4/)).toBeInTheDocument());
    expect(api.edit).toHaveBeenCalledTimes(1);
  });
});
