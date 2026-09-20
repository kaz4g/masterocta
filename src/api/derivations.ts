import { ipcClient, type IpcClient } from "./client";

export interface DerivationProcessor {
  name: string;
  revision: string;
}

export interface DerivationParameters {
  status: "available" | "unavailable";
  startFrame?: string;
  endFrameExclusive?: string;
  role?: string;
}

export interface AssetDerivationRecord {
  assetId: string;
  kind: string;
  parentAssetId: string;
  parentAvailable: boolean;
  processor: DerivationProcessor;
  createdAt: string;
  parameters: DerivationParameters;
}

export interface AssetDerivationGetResult {
  assetId: string;
  isDerived: boolean;
  derivation: AssetDerivationRecord | null;
}

export interface AssetDerivationListChildrenResult {
  assetId: string;
  children: AssetDerivationRecord[];
}

export interface DerivationsApi {
  getAssetDerivation(rootId: string, assetId: string): Promise<AssetDerivationGetResult>;
  listDerivedChildren(
    rootId: string,
    assetId: string,
  ): Promise<AssetDerivationListChildrenResult>;
}

export function createDerivationsApi(client: IpcClient = ipcClient): DerivationsApi {
  return {
    getAssetDerivation: (rootId, assetId) =>
      client.request<AssetDerivationGetResult>("v2_asset_derivation_get", {
        rootId,
        assetId,
      }),
    listDerivedChildren: (rootId, assetId) =>
      client.request<AssetDerivationListChildrenResult>(
        "v2_asset_derivation_list_children",
        { rootId, assetId },
      ),
  };
}

export const derivationsApi = createDerivationsApi();
