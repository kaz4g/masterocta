import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __MO_E2E_TRY_DERIVATION_IPC__?: (
      cmd: string,
      args: Record<string, unknown>,
    ) => unknown;
  }
}

/** Registers default read-only derivation IPC responses for E2E invoke mocks. */
export async function installDerivationIpcDefaults(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__MO_E2E_TRY_DERIVATION_IPC__ = (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "v2_asset_derivation_get") {
        return {
          assetId: String(args.assetId ?? ""),
          isDerived: false,
          derivation: null,
        };
      }
      if (cmd === "v2_asset_derivation_list_children") {
        return {
          assetId: String(args.assetId ?? ""),
          children: [],
        };
      }
      return undefined;
    };
  });
}
