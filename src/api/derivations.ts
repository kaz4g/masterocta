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

function normalizeAssetDerivationGet(
  assetId: string,
  raw: AssetDerivationGetResult | null | undefined,
): AssetDerivationGetResult {
  if (raw == null) {
    return { assetId, isDerived: false, derivation: null };
  }
  return {
    assetId: raw.assetId ?? assetId,
    isDerived: Boolean(raw.isDerived),
    derivation: raw.derivation ?? null,
  };
}

function normalizeAssetDerivationListChildren(
  assetId: string,
  raw: AssetDerivationListChildrenResult | null | undefined,
): AssetDerivationListChildrenResult {
  if (raw == null) {
    return { assetId, children: [] };
  }
  return {
    assetId: raw.assetId ?? assetId,
    children: Array.isArray(raw.children) ? raw.children : [],
  };
}

export function createDerivationsApi(client: IpcClient = ipcClient): DerivationsApi {
  return {
    getAssetDerivation: async (rootId, assetId) => {
      const raw = await client.request<AssetDerivationGetResult | null>(
        "v2_asset_derivation_get",
        { rootId, assetId },
      );
      return normalizeAssetDerivationGet(assetId, raw);
    },
    listDerivedChildren: async (rootId, assetId) => {
      const raw = await client.request<AssetDerivationListChildrenResult | null>(
        "v2_asset_derivation_list_children",
        { rootId, assetId },
      );
      return normalizeAssetDerivationListChildren(assetId, raw);
    },
  };
}

export const derivationsApi = createDerivationsApi();
