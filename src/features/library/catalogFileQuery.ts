import type { LibraryAudioFile } from "../../api";

export type CatalogFileSort = "name" | "size";

export const CATALOG_PAGE_SIZE = 100;

export interface CatalogFileQueryInput {
  files: LibraryAudioFile[];
  search: string;
  sort: CatalogFileSort;
  page: number;
}

export interface CatalogFileQueryResult {
  matching: LibraryAudioFile[];
  visible: LibraryAudioFile[];
  page: number;
  lastPage: number;
  locationCount: number;
  matchingCount: number;
}

function compareByName(left: LibraryAudioFile, right: LibraryAudioFile): number {
  if (left.relativePath < right.relativePath) return -1;
  if (left.relativePath > right.relativePath) return 1;
  return 0;
}

function compareBySize(left: LibraryAudioFile, right: LibraryAudioFile): number {
  if (right.byteSize !== left.byteSize) return right.byteSize - left.byteSize;
  return compareByName(left, right);
}

export function queryCatalogFiles(input: CatalogFileQueryInput): CatalogFileQueryResult {
  const locationCount = input.files.length;
  const term = input.search.trim().toLocaleLowerCase();
  const matching = input.files
    .filter((file) => {
      if (term === "") return true;
      return (
        file.displayName.toLocaleLowerCase().includes(term)
        || file.relativePath.toLocaleLowerCase().includes(term)
      );
    })
    .slice()
    .sort(input.sort === "size" ? compareBySize : compareByName);

  const matchingCount = matching.length;
  const lastPage = Math.max(0, Math.ceil(matchingCount / CATALOG_PAGE_SIZE) - 1);
  const page = Math.min(Math.max(0, input.page), lastPage);
  const start = page * CATALOG_PAGE_SIZE;
  const visible = matching.slice(start, start + CATALOG_PAGE_SIZE);

  return {
    matching,
    visible,
    page,
    lastPage,
    locationCount,
    matchingCount,
  };
}
