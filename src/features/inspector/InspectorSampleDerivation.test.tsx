import type { ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../i18n";
import { tJa } from "../../i18n/testStrings";
import type { DerivationsApi } from "../../api/derivations";
import { InspectorSampleDerivation } from "./InspectorSampleDerivation";

function renderWithLocale(ui: ReactElement) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

describe("InspectorSampleDerivation", () => {
  it("shows original material when no lineage exists", async () => {
    const api: DerivationsApi = {
      getAssetDerivation: vi.fn().mockResolvedValue({
        assetId: "asset-1",
        isDerived: false,
        derivation: null,
      }),
      listDerivedChildren: vi.fn().mockResolvedValue({ assetId: "asset-1", children: [] }),
    };
    renderWithLocale(
      <InspectorSampleDerivation rootId="root-1" assetId="asset-1" api={api} />,
    );
    await waitFor(() => expect(screen.getByTestId("inspector-derivation-original")).toBeInTheDocument());
    expect(screen.getByText(tJa("inspector.derivationOriginalMaterial"))).toBeInTheDocument();
  });

  it("lists SLICE_EXPORT child for an original asset", async () => {
    const api: DerivationsApi = {
      getAssetDerivation: vi.fn().mockResolvedValue({
        assetId: "asset-source",
        isDerived: false,
        derivation: null,
      }),
      listDerivedChildren: vi.fn().mockResolvedValue({
        assetId: "asset-source",
        children: [{
          assetId: "asset-child",
          kind: "SLICE_EXPORT",
          parentAssetId: "asset-source",
          parentAvailable: true,
          processor: { name: "masterocta-trim", revision: "pcm-wav-v1" },
          createdAt: "2026-09-21T00:00:00.000Z",
          parameters: {
            status: "available",
            startFrame: "500",
            endFrameExclusive: "3500",
          },
        }],
      }),
    };
    renderWithLocale(
      <InspectorSampleDerivation
        rootId="root-1"
        assetId="asset-source"
        sampleRate={44100}
        api={api}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("inspector-derivation-children")).toBeInTheDocument());
    expect(screen.getByText(tJa("inspector.derivationKind.SLICE_EXPORT"))).toBeInTheDocument();
    expect(screen.getByText("asset-child")).toBeInTheDocument();
    expect(screen.queryByText(/sha256:/)).not.toBeInTheDocument();
  });

  it("shows parent lineage for derived asset", async () => {
    const api: DerivationsApi = {
      getAssetDerivation: vi.fn().mockResolvedValue({
        assetId: "asset-derived",
        isDerived: true,
        derivation: {
          assetId: "asset-derived",
          kind: "TRIM",
          parentAssetId: "asset-source",
          parentAvailable: false,
          processor: { name: "masterocta-trim", revision: "pcm-wav-v1" },
          createdAt: "2026-09-21T00:00:00.000Z",
          parameters: { status: "unavailable" },
        },
      }),
      listDerivedChildren: vi.fn().mockResolvedValue({ assetId: "asset-derived", children: [] }),
    };
    renderWithLocale(
      <InspectorSampleDerivation rootId="root-1" assetId="asset-derived" api={api} />,
    );
    await waitFor(() => expect(screen.getByTestId("inspector-derivation-parent")).toBeInTheDocument());
    expect(screen.getByText(tJa("inspector.derivationParametersUnavailable"))).toBeInTheDocument();
    expect(screen.getByText(tJa("inspector.derivationParentUnavailable"))).toBeInTheDocument();
  });

  it("ignores stale responses after asset switch", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    const api: DerivationsApi = {
      getAssetDerivation: vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockResolvedValue({
          assetId: "asset-b",
          isDerived: false,
          derivation: null,
        }),
      listDerivedChildren: vi.fn()
        .mockResolvedValueOnce({ assetId: "asset-a", children: [] })
        .mockResolvedValue({ assetId: "asset-b", children: [] }),
    };
    const { rerender } = renderWithLocale(
      <InspectorSampleDerivation rootId="root-1" assetId="asset-a" api={api} />,
    );
    rerender(
      <LocaleProvider>
        <InspectorSampleDerivation rootId="root-1" assetId="asset-b" api={api} />
      </LocaleProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("inspector-derivation-original")).toBeInTheDocument());
    resolveFirst({
      assetId: "asset-a",
      isDerived: true,
      derivation: {
        assetId: "asset-a",
        kind: "TRIM",
        parentAssetId: "asset-stale",
        parentAvailable: true,
        processor: { name: "x", revision: "y" },
        createdAt: "2026-09-21T00:00:00.000Z",
        parameters: { status: "available" },
      },
    });
    expect(screen.queryByText("asset-stale")).not.toBeInTheDocument();
  });
});
