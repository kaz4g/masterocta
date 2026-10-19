import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../design-system/themes/ThemeProvider";
import { tJa } from "../../i18n/testStrings";
import { WorkspaceTopBar, type WorkspaceTopBarProps } from "./WorkspaceTopBar";

function renderTopBar(overrides: Partial<WorkspaceTopBarProps> = {}) {
  const onSearchChange = vi.fn();
  render(
    <ThemeProvider>
      <WorkspaceTopBar
        session={null}
        writeEnabled={false}
        writeBlocked={false}
        busy={false}
        search=""
        onSearchChange={onSearchChange}
        onChooseRoot={vi.fn()}
        onRefreshCatalog={vi.fn()}
        onCloseRoot={vi.fn()}
        onEnableWrite={vi.fn()}
        onDisableWrite={vi.fn()}
        catalogReady
        {...overrides}
      />
    </ThemeProvider>,
  );
  return { onSearchChange };
}

describe("WorkspaceTopBar search shortcut", () => {
  it("focuses the search field on Ctrl+F and Cmd+F", () => {
    renderTopBar();
    const search = screen.getByLabelText(tJa("library.searchAria"));
    expect(search).toHaveAttribute("aria-keyshortcuts", "Control+F Meta+F");
    expect(search).toHaveAttribute("title", tJa("library.searchShortcutHint"));

    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(search);

    screen.getByRole("button", { name: tJa("sources.chooseRoot") }).focus();
    fireEvent.keyDown(document, { key: "f", metaKey: true });
    expect(document.activeElement).toBe(search);
  });

  it("does not steal focus while an open dialog is present", () => {
    renderTopBar();
    const search = screen.getByLabelText(tJa("library.searchAria"));
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);

    const notPrevented = fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    expect(notPrevented).toBe(false);
    expect(document.activeElement).not.toBe(search);
    dialog.remove();
  });

  it("does not focus a disabled search field", () => {
    renderTopBar({ catalogReady: false });
    const search = screen.getByLabelText(tJa("library.searchAria"));
    expect(search).toBeDisabled();
    const notPrevented = fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    expect(notPrevented).toBe(false);
    expect(document.activeElement).not.toBe(search);
  });
});
