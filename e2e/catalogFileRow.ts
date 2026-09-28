import { expect, type Page } from "@playwright/test";
import { uiText } from "./i18n";

export async function clickCatalogFileRow(
  page: Page,
  locale: "ja" | "en",
  displayName: string,
) {
  const row = catalogFileRowLocator(page, locale, displayName);
  await expect(row).toBeVisible({ timeout: 60000 });
  await row.scrollIntoViewIfNeeded();
  await row.click();
}

export function catalogFileRowLocator(
  page: Page,
  locale: "ja" | "en",
  displayName: string,
) {
  return page
    .getByLabel(uiText(locale, "library.audioFilesAria"))
    .locator(".catalog-file-table__row", { hasText: displayName });
}

/** Rename via Inspector sample ops (primary entry; opens Operations Drawer). */
export async function openSampleRenameFromCatalog(page: Page, locale: "ja" | "en") {
  const rename = page
    .getByTestId("inspector-workspace-host")
    .getByRole("button", { name: uiText(locale, "inspector.renameAction") });
  await expect(rename).toBeVisible({ timeout: 15000 });
  await rename.click();
}
