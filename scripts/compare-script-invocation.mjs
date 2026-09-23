import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string} path
 * @returns {string}
 */
export function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * True when this module file was invoked directly (not imported).
 * Compares canonical paths so macOS /var vs /private/var does not false-negative.
 *
 * @param {string} metaUrl import.meta.url of the entry script
 */
export function isDirectScriptInvocation(metaUrl) {
  if (!process.argv[1]) {
    return false;
  }
  const selfPath = canonicalPath(fileURLToPath(metaUrl));
  const invoked = canonicalPath(resolve(process.argv[1]));
  return selfPath === invoked;
}
