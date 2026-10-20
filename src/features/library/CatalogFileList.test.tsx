import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LibraryAudioFile } from "../../api";
import { tJa } from "../../i18n/testStrings";
import { CATALOG_PAGE_SIZE } from "./catalogFileQuery";
import { CatalogFileList, type CatalogFileListProps } from "./CatalogFileList";

function makeFile(id: string, name: string, size: number): LibraryAudioFile {
  return {
    fileInstanceId: id,
    assetId: `asset:${id}`,
    displayName: name,
    relativePath: `LIVE_SET/AUDIO/${name}`,
    byteSize: size,
    storageScope: "set_audio_pool",
  };
}

const manyFiles = Array.from({ length: CATALOG_PAGE_SIZE + 1 }, (_, index) =>
  makeFile(`file-${index}`, `sample-${index}.wav`, index * 100),
);

describe("CatalogFileList", () => {
  it("renders name, size, and format columns", () => {
    const files = [makeFile("a", "KICK.wav", 2048)];
    render(
      <CatalogFileList
        fileQuery={{
          visible: files,
          page: 0,
          lastPage: 0,
          locationCount: 1,
          matchingCount: 1,
        }}
        locationFiles={files}
        search=""
        sort="name"
        selectedFileInstanceId={null}
        onSelectFile={vi.fn()}
        onSortChange={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("columnheader", { name: tJa("library.columnName") })).toBeInTheDocument();
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "2");
    expect(screen.getByText("KICK.wav")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("WAV")).toBeInTheDocument();
  });

  it("shows off-page selection notice without clearing selection", () => {
    render(
      <CatalogFileList
        fileQuery={{
          visible: manyFiles.slice(0, CATALOG_PAGE_SIZE),
          page: 0,
          lastPage: 1,
          locationCount: manyFiles.length,
          matchingCount: manyFiles.length,
        }}
        locationFiles={manyFiles}
        search=""
        sort="name"
        selectedFileInstanceId="file-100"
        onSelectFile={vi.fn()}
        onSortChange={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText(tJa("library.selectionOffPage"))).toBeInTheDocument();
    const grid = screen.getByRole("grid");
    expect(within(grid).queryByText("sample-100.wav")).not.toBeInTheDocument();
  });

  it("marks the selected row with aria-selected", () => {
    const files = [makeFile("a", "A.wav", 100), makeFile("b", "B.wav", 200)];
    render(
      <CatalogFileList
        fileQuery={{
          visible: files,
          page: 0,
          lastPage: 0,
          locationCount: 2,
          matchingCount: 2,
        }}
        locationFiles={files}
        search=""
        sort="name"
        selectedFileInstanceId="b"
        onSelectFile={vi.fn()}
        onSortChange={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );
    const dataRows = screen.getAllByRole("row").filter((row) =>
      row.classList.contains("catalog-file-table__row"),
    );
    expect(dataRows[0]).toHaveAttribute("aria-selected", "false");
    expect(dataRows[1]).toHaveAttribute("aria-selected", "true");
  });

  it("distinguishes empty location from search miss", () => {
    const { rerender } = render(
      <CatalogFileList
        fileQuery={{
          visible: [],
          page: 0,
          lastPage: 0,
          locationCount: 0,
          matchingCount: 0,
        }}
        locationFiles={[]}
        search=""
        sort="name"
        selectedFileInstanceId={null}
        onSelectFile={vi.fn()}
        onSortChange={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText(tJa("library.noFilesHere"))).toBeInTheDocument();
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "1");

    rerender(
      <CatalogFileList
        fileQuery={{
          visible: [],
          page: 0,
          lastPage: 0,
          locationCount: 2,
          matchingCount: 0,
        }}
        locationFiles={[makeFile("a", "A.wav", 100), makeFile("b", "B.wav", 200)]}
        search="zzz"
        sort="name"
        selectedFileInstanceId={null}
        onSelectFile={vi.fn()}
        onSortChange={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText(tJa("library.noSearchMatches"))).toBeInTheDocument();
  });

  it("shows refresh and error status without hiding rows", () => {
    const files = [makeFile("a", "A.wav", 100)];
    render(
      <CatalogFileList
        fileQuery={{
          visible: files,
          page: 0,
          lastPage: 0,
          locationCount: 1,
          matchingCount: 1,
        }}
        locationFiles={files}
        search=""
        sort="name"
        selectedFileInstanceId={null}
        onSelectFile={vi.fn()}
        onSortChange={vi.fn()}
        onPageChange={vi.fn()}
        catalogRefreshing
        catalogError="network"
      />,
    );
    expect(screen.getByText(tJa("library.fileListRefreshing"))).toBeInTheDocument();
    expect(screen.getByText(tJa("library.fileListLoadFailed"))).toBeInTheDocument();
    expect(screen.getByText("A.wav")).toBeInTheDocument();
  });

  function renderList(
    files: LibraryAudioFile[],
    overrides: Partial<CatalogFileListProps> = {},
  ) {
    const onSelectFile = vi.fn();
    const view = render(
      <CatalogFileList
        fileQuery={{
          visible: files,
          page: 0,
          lastPage: 0,
          locationCount: files.length,
          matchingCount: files.length,
        }}
        locationFiles={files}
        search=""
        sort="name"
        selectedFileInstanceId={null}
        onSelectFile={onSelectFile}
        onSortChange={vi.fn()}
        onPageChange={vi.fn()}
        {...overrides}
      />,
    );
    return { ...view, onSelectFile };
  }

  function dataRows() {
    return screen.getAllByRole("row").filter((row) =>
      row.classList.contains("catalog-file-table__row"),
    );
  }

  it("calls onSelectFile when a row is clicked", () => {
    const files = [makeFile("a", "A.wav", 100)];
    const onSelectFile = vi.fn();
    render(
      <CatalogFileList
        fileQuery={{
          visible: files,
          page: 0,
          lastPage: 0,
          locationCount: 1,
          matchingCount: 1,
        }}
        locationFiles={files}
        search=""
        sort="name"
        selectedFileInstanceId={null}
        onSelectFile={onSelectFile}
        onSortChange={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("A.wav"));
    expect(onSelectFile).toHaveBeenCalledWith("a");
  });

  it("moves selection with ArrowUp and ArrowDown on a focused row", () => {
    const files = [makeFile("a", "A.wav", 100), makeFile("b", "B.wav", 200), makeFile("c", "C.wav", 300)];
    const { onSelectFile, rerender } = renderList(files, { selectedFileInstanceId: "a" });
    const rows = dataRows();
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown" });
    expect(onSelectFile).toHaveBeenCalledWith("b");

    rerender(
      <CatalogFileList
        fileQuery={{
          visible: files,
          page: 0,
          lastPage: 0,
          locationCount: 3,
          matchingCount: 3,
        }}
        locationFiles={files}
        search=""
        sort="name"
        selectedFileInstanceId="b"
        onSelectFile={onSelectFile}
        onSortChange={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );
    onSelectFile.mockClear();
    fireEvent.keyDown(dataRows()[1], { key: "ArrowUp" });
    expect(onSelectFile).toHaveBeenCalledWith("a");
  });

  it("selects the first visible row when ArrowDown is pressed with no selection", () => {
    const files = [makeFile("a", "A.wav", 100), makeFile("b", "B.wav", 200)];
    const { onSelectFile } = renderList(files);
    fireEvent.keyDown(dataRows()[0], { key: "ArrowDown" });
    expect(onSelectFile).toHaveBeenCalledWith("a");
  });

  it("does not change selection with Space or while a dialog is open", () => {
    const files = [makeFile("a", "A.wav", 100), makeFile("b", "B.wav", 200)];
    const { onSelectFile } = renderList(files, { selectedFileInstanceId: "a" });
    fireEvent.keyDown(dataRows()[0], { key: " " });
    expect(onSelectFile).not.toHaveBeenCalled();

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    fireEvent.keyDown(dataRows()[0], { key: "ArrowDown" });
    expect(onSelectFile).not.toHaveBeenCalled();
    dialog.remove();
  });

  it("does not move selection while the list search field is focused", () => {
    const files = [makeFile("a", "A.wav", 100), makeFile("b", "B.wav", 200)];
    const onSearchChange = vi.fn();
    const { onSelectFile } = renderList(files, {
      selectedFileInstanceId: "a",
      onSearchChange,
    });
    const search = screen.getByLabelText(tJa("library.searchAria"));
    search.focus();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(onSelectFile).not.toHaveBeenCalled();
  });
});
