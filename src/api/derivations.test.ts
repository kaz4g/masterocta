import { describe, expect, it, vi } from "vitest";

vi.unmock("./derivations");
import type { IpcClient, IpcCommandArgs } from "./client";
import { createDerivationsApi } from "./derivations";

function mockClient(responses: Record<string, unknown>): IpcClient {
  const request = async <Response>(
    command: string,
    _args?: IpcCommandArgs,
  ): Promise<Response> => responses[command] as Response;
  return { request: vi.fn(request) as IpcClient["request"] };
}

describe("derivations API", () => {
  it("normalizes null get response to original asset contract", async () => {
    const api = createDerivationsApi(
      mockClient({ v2_asset_derivation_get: null, v2_asset_derivation_list_children: null }),
    );
    await expect(api.getAssetDerivation("root-1", "asset-1")).resolves.toEqual({
      assetId: "asset-1",
      isDerived: false,
      derivation: null,
    });
  });

  it("normalizes null children response to empty list", async () => {
    const api = createDerivationsApi(
      mockClient({ v2_asset_derivation_list_children: null }),
    );
    await expect(api.listDerivedChildren("root-1", "asset-1")).resolves.toEqual({
      assetId: "asset-1",
      children: [],
    });
  });

  it("passes through derived get response", async () => {
    const derived = {
      assetId: "asset-d",
      kind: "TRIM",
      parentAssetId: "asset-p",
      parentAvailable: true,
      processor: { name: "masterocta-trim", revision: "pcm-wav-v1" },
      createdAt: "2026-09-21T00:00:00.000Z",
      parameters: { status: "available" as const },
    };
    const api = createDerivationsApi(
      mockClient({
        v2_asset_derivation_get: {
          assetId: "asset-d",
          isDerived: true,
          derivation: derived,
        },
      }),
    );
    await expect(api.getAssetDerivation("root-1", "asset-d")).resolves.toEqual({
      assetId: "asset-d",
      isDerived: true,
      derivation: derived,
    });
  });
});
