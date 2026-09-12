import { describe, expect, it } from "vitest";
import type { LibraryAudioFile } from "../../api";
import { CATALOG_PAGE_SIZE, queryCatalogFiles } from "./catalogFileQuery";

function file(
  id: string,
  path: string,
  byteSize: number,
  displayName?: string,
): LibraryAudioFile {
  return {
    fileInstanceId: id,
    assetId: `asset:${id}`,
    displayName: displayName ?? path.split("/").pop() ?? path,
    relativePath: path,
    byteSize,
    storageScope: "set_audio_pool",
  };
}

describe("queryCatalogFiles", () => {
  it("filters, sorts by name, and paginates within the location set", () => {
    const files = Array.from({ length: 101 }, (_, index) =>
      file(`id-${index}`, `LIVE_SET/AUDIO/file-${String(index).padStart(3, "0")}.wav`, index),
    );

    const page0 = queryCatalogFiles({ files, search: "", sort: "name", page: 0 });
    expect(page0.locationCount).toBe(101);
    expect(page0.matchingCount).toBe(101);
    expect(page0.visible).toHaveLength(CATALOG_PAGE_SIZE);
    expect(page0.lastPage).toBe(1);

    const page1 = queryCatalogFiles({ files, search: "", sort: "name", page: 1 });
    expect(page1.visible).toHaveLength(1);
    expect(page1.page).toBe(1);
  });

  it("sorts by display name when folder paths would order differently", () => {
    const files = [
      file("b", "LIVE_SET/AUDIO/beta.wav", 1),
      file("a", "LIVE_SET/omega/alpha.wav", 2, "alpha.wav"),
    ];
    const result = queryCatalogFiles({ files, search: "", sort: "name", page: 0 });
    expect(result.visible.map((entry) => entry.displayName)).toEqual(["alpha.wav", "beta.wav"]);
  });

  it("sorts by size descending and keeps name tie-breaker", () => {
    const files = [
      file("a", "LIVE_SET/AUDIO/a.wav", 100),
      file("b", "LIVE_SET/AUDIO/b.wav", 500),
      file("c", "LIVE_SET/AUDIO/c.wav", 500),
    ];
    const result = queryCatalogFiles({ files, search: "", sort: "size", page: 0 });
    expect(result.visible.map((entry) => entry.fileInstanceId)).toEqual(["b", "c", "a"]);
  });

  it("clamps page when filters shrink the result set", () => {
    const files = Array.from({ length: 150 }, (_, index) =>
      file(`id-${index}`, `LIVE_SET/AUDIO/sample-${index}.wav`, index),
    );
    const result = queryCatalogFiles({
      files,
      search: "sample-1",
      sort: "name",
      page: 99,
    });
    expect(result.matchingCount).toBeGreaterThan(0);
    expect(result.matchingCount).toBeLessThan(150);
    expect(result.page).toBeLessThanOrEqual(result.lastPage);
    expect(result.visible.length).toBeGreaterThan(0);
  });

  it("matches display names and relative paths case-insensitively", () => {
    const files = [
      file("kick", "LIVE_SET/AUDIO/KICK.wav", 1),
      file("snare", "LIVE_SET/AUDIO/snare.wav", 2),
    ];
    const byName = queryCatalogFiles({ files, search: "kick", sort: "name", page: 0 });
    expect(byName.matchingCount).toBe(1);
    const byPath = queryCatalogFiles({ files, search: "snare", sort: "name", page: 0 });
    expect(byPath.matchingCount).toBe(1);
  });
});
