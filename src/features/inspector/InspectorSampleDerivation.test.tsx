import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider, useLocale } from "../../i18n";
import { tJa } from "../../i18n/testStrings";
import { createDerivationsApi, type AssetDerivationRecord, type DerivationsApi } from "../../api/derivations";
import { InspectorSampleDerivation } from "./InspectorSampleDerivation";

function renderWithLocale(ui: ReactElement) {
  return render(<LocaleProvider initialLocaleId="ja">{ui}</LocaleProvider>);
}

function originalApi(assetId: string): DerivationsApi {
  return {
    getAssetDerivation: vi.fn().mockResolvedValue({
      assetId,
      isDerived: false,
      derivation: null,
    }),
    listDerivedChildren: vi.fn().mockResolvedValue({ assetId, children: [] }),
  };
}

function derivationRecord(
  assetId: string,
  parentAssetId: string,
  kind: string,
): AssetDerivationRecord {
  return {
    assetId,
    kind,
    parentAssetId,
    parentAvailable: true,
    processor: { name: "masterocta-trim", revision: "pcm-wav-v1" },
    createdAt: "2026-09-21T00:00:00.000Z",
    parameters: {
      status: "available",
      startFrame: "500",
      endFrameExclusive: "3500",
    },
  };
}

describe("InspectorSampleDerivation", () => {
  it("shows original material when no lineage exists", async () => {
    const api = originalApi("asset-1");
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
        children: [derivationRecord("asset-child", "asset-source", "SLICE_EXPORT")],
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
    expect(screen.queryByTestId("inspector-derivation-parent")).not.toBeInTheDocument();
  });

  it("shows parent lineage for derived asset without children", async () => {
    const api: DerivationsApi = {
      getAssetDerivation: vi.fn().mockResolvedValue({
        assetId: "asset-derived",
        isDerived: true,
        derivation: {
          ...derivationRecord("asset-derived", "asset-source", "TRIM"),
          parentAvailable: false,
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
    expect(screen.queryByTestId("inspector-derivation-children")).not.toBeInTheDocument();
  });

  it("shows parent and children together for an intermediate derived asset", async () => {
    const api: DerivationsApi = {
      getAssetDerivation: vi.fn().mockResolvedValue({
        assetId: "asset-trim",
        isDerived: true,
        derivation: derivationRecord("asset-trim", "asset-original", "TRIM"),
      }),
      listDerivedChildren: vi.fn().mockResolvedValue({
        assetId: "asset-trim",
        children: [derivationRecord("asset-slice", "asset-trim", "SLICE_EXPORT")],
      }),
    };
    renderWithLocale(
      <InspectorSampleDerivation rootId="root-1" assetId="asset-trim" api={api} />,
    );
    await waitFor(() => expect(screen.getByTestId("inspector-derivation-parent")).toBeInTheDocument());
    expect(screen.getByTestId("inspector-derivation-children")).toBeInTheDocument();
    expect(screen.getByText(tJa("inspector.derivationKind.TRIM"))).toBeInTheDocument();
    expect(screen.getByText(tJa("inspector.derivationKind.SLICE_EXPORT"))).toBeInTheDocument();
    expect(screen.getByText("asset-original")).toBeInTheDocument();
    expect(screen.getByText("asset-slice")).toBeInTheDocument();
  });

  it("treats null IPC responses as original material without crashing", async () => {
    const api = createDerivationsApi({
      request: vi.fn().mockResolvedValue(null),
    });
    renderWithLocale(
      <InspectorSampleDerivation rootId="root-1" assetId="asset-1" api={api} />,
    );
    await waitFor(() => expect(screen.getByTestId("inspector-derivation-original")).toBeInTheDocument());
  });

  it("does not query lineage while disabled", () => {
    const api = originalApi("asset-1");
    renderWithLocale(
      <InspectorSampleDerivation rootId="root-1" assetId="asset-1" enabled={false} api={api} />,
    );
    expect(api.getAssetDerivation).not.toHaveBeenCalled();
    expect(api.listDerivedChildren).not.toHaveBeenCalled();
    expect(screen.queryByTestId("inspector-derivation-loading")).not.toBeInTheDocument();
  });

  it("starts lineage query when enabled becomes true", async () => {
    const api = originalApi("asset-1");
    const { rerender } = renderWithLocale(
      <InspectorSampleDerivation rootId="root-1" assetId="asset-1" enabled={false} api={api} />,
    );
    expect(api.getAssetDerivation).not.toHaveBeenCalled();
    rerender(
      <LocaleProvider initialLocaleId="ja">
        <InspectorSampleDerivation rootId="root-1" assetId="asset-1" enabled api={api} />
      </LocaleProvider>,
    );
    await waitFor(() => expect(api.getAssetDerivation).toHaveBeenCalledTimes(1));
    expect(api.listDerivedChildren).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("inspector-derivation-original")).toBeInTheDocument());
  });

  it("does not query on asset switch while disabled", () => {
    const api = originalApi("asset-a");
    const { rerender } = renderWithLocale(
      <InspectorSampleDerivation rootId="root-1" assetId="asset-a" enabled={false} api={api} />,
    );
    rerender(
      <LocaleProvider initialLocaleId="ja">
        <InspectorSampleDerivation rootId="root-1" assetId="asset-b" enabled={false} api={api} />
      </LocaleProvider>,
    );
    expect(api.getAssetDerivation).not.toHaveBeenCalled();
    expect(api.listDerivedChildren).not.toHaveBeenCalled();
  });

  it("queries the selected asset when enabled during an asset switch", async () => {
    const api: DerivationsApi = {
      getAssetDerivation: vi.fn().mockImplementation((_rootId: string, assetId: string) =>
        Promise.resolve({ assetId, isDerived: false, derivation: null }),
      ),
      listDerivedChildren: vi.fn().mockImplementation((_rootId: string, assetId: string) =>
        Promise.resolve({ assetId, children: [] }),
      ),
    };
    const { rerender } = renderWithLocale(
      <InspectorSampleDerivation rootId="root-1" assetId="asset-a" enabled api={api} />,
    );
    await waitFor(() => expect(api.getAssetDerivation).toHaveBeenCalledWith("root-1", "asset-a"));
    rerender(
      <LocaleProvider initialLocaleId="ja">
        <InspectorSampleDerivation rootId="root-1" assetId="asset-b" enabled api={api} />
      </LocaleProvider>,
    );
    await waitFor(() => expect(api.getAssetDerivation).toHaveBeenCalledWith("root-1", "asset-b"));
  });

  it("does not query a refresh while disabled, then loads on enable", async () => {
    const api = originalApi("asset-1");
    const { rerender } = renderWithLocale(
      <InspectorSampleDerivation
        rootId="root-1"
        assetId="asset-1"
        enabled={false}
        refreshGeneration={0}
        api={api}
      />,
    );
    rerender(
      <LocaleProvider initialLocaleId="ja">
        <InspectorSampleDerivation
          rootId="root-1"
          assetId="asset-1"
          enabled={false}
          refreshGeneration={1}
          api={api}
        />
      </LocaleProvider>,
    );
    expect(api.getAssetDerivation).not.toHaveBeenCalled();
    rerender(
      <LocaleProvider initialLocaleId="ja">
        <InspectorSampleDerivation
          rootId="root-1"
          assetId="asset-1"
          enabled
          refreshGeneration={1}
          api={api}
        />
      </LocaleProvider>,
    );
    await waitFor(() => expect(api.getAssetDerivation).toHaveBeenCalledTimes(1));
  });

  it("does not refetch lineage on locale change", async () => {
    const api = originalApi("asset-1");
    function Harness() {
      const { localeId, setLocaleId } = useLocale();
      return (
        <>
          <button type="button" aria-label="Toggle locale" onClick={() => setLocaleId(localeId === "ja" ? "en" : "ja")} />
          <InspectorSampleDerivation rootId="root-1" assetId="asset-1" enabled api={api} />
        </>
      );
    }
    renderWithLocale(<Harness />);
    await waitFor(() => expect(screen.getByTestId("inspector-derivation-original")).toBeInTheDocument());
    expect(api.getAssetDerivation).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Toggle locale" }));
    await waitFor(() => expect(screen.getByText("Original sample (no derived lineage recorded).")).toBeInTheDocument());
    expect(api.getAssetDerivation).toHaveBeenCalledTimes(1);
    expect(api.listDerivedChildren).toHaveBeenCalledTimes(1);
  });

  it("shows lineage integrity errors without crashing", async () => {
    const api: DerivationsApi = {
      getAssetDerivation: vi.fn().mockRejectedValue({ code: "CATALOG_INTEGRITY_ERROR" }),
      listDerivedChildren: vi.fn().mockRejectedValue({ code: "CATALOG_INTEGRITY_ERROR" }),
    };
    renderWithLocale(
      <InspectorSampleDerivation rootId="root-1" assetId="asset-1" api={api} />,
    );
    await waitFor(() => expect(screen.getByTestId("inspector-derivation-error")).toBeInTheDocument());
    expect(screen.getByText(tJa("inspector.derivationError.CATALOG_INTEGRITY_ERROR"))).toBeInTheDocument();
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
      <LocaleProvider initialLocaleId="ja">
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
