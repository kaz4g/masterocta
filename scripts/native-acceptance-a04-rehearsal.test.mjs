import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const dir = dirname(fileURLToPath(import.meta.url));
const rehearsal = readFileSync(join(dir, "native-acceptance-a04-rehearsal.sh"), "utf8");

test("rehearsal script is labeled non-canonical", () => {
  assert.match(rehearsal, /A04_AUTOMATION_REHEARSAL_ONLY/);
  assert.match(rehearsal, /NOT_CANONICAL_EVIDENCE/);
  assert.match(rehearsal, /register-root/);
  assert.match(rehearsal, /a04-reanalyze-and-cancel/);
  assert.match(rehearsal, /A04_CANCEL_SAFETY/);
  assert.doesNotMatch(rehearsal, /A04_\[A-Z_\]\+/);
  assert.match(rehearsal, /slice_count=/);
  assert.doesNotMatch(rehearsal, /markers=4/);
  assert.match(rehearsal, /MARKERS_BEFORE/);
  assert.match(rehearsal, /FRAMES_BEFORE/);
  assert.match(rehearsal, /CANCEL_WINDOW_NOT_OBSERVED/);
  assert.match(rehearsal, /CANCEL_SAFETY_STATUS=NOT_RUN/);
  assert.match(rehearsal, /SINGLE_FRESH_HOME_FULL_RUN/);
  assert.match(rehearsal, /A04_REPAIR5_FINAL_REPORT/);
  assert.match(rehearsal, /FRONTMOST_AX_NOT_STABLE/);
  assert.match(rehearsal, /CANCEL_TERMINAL_PASS/);
  assert.match(rehearsal, /emit_final_report/);
  assert.match(rehearsal, /a04-session-usable/);
  assert.match(rehearsal, /PRODUCT_BUG_FOUND/);
  assert.match(rehearsal, /CANCEL_AX_OUT/);
  const terminalAt = rehearsal.indexOf("CANCEL_TERMINAL_STATE=PASS");
  const afterAt = rehearsal.indexOf('AFTER="$(draft_snapshot)"');
  assert.ok(terminalAt > 0 && afterAt > terminalAt);
  assert.doesNotMatch(rehearsal, /sleep 340|A04_REANALYZE_CANCEL_DELAY/);
});

const SNAPSHOT_SCHEMA = `
CREATE TABLE slice_drafts (
  id INTEGER PRIMARY KEY,
  revision INTEGER NOT NULL,
  region_start TEXT NOT NULL,
  region_end TEXT NOT NULL
);
CREATE TABLE slice_draft_markers (
  draft_id INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  marker_id TEXT NOT NULL,
  start_frame TEXT NOT NULL,
  locked INTEGER NOT NULL,
  manual INTEGER NOT NULL,
  candidate_id TEXT,
  estimated_attack TEXT,
  PRIMARY KEY (draft_id, ordinal)
);
`;

function draftSnapshotSql(source) {
  const start = source.indexOf("draft_snapshot() {");
  assert.ok(start >= 0, "draft_snapshot function");
  const header = "<<SQL\n";
  const sqlStart = source.indexOf(header, start);
  assert.ok(sqlStart >= 0, "draft_snapshot SQL");
  const bodyStart = sqlStart + header.length;
  const sqlEnd = source.indexOf("\nSQL\n", bodyStart);
  assert.ok(sqlEnd > bodyStart, "draft_snapshot SQL terminator");
  return source.slice(bodyStart, sqlEnd);
}

function runDraftSnapshot(setupSql) {
  const dir = mkdtempSync(join(tmpdir(), "a04-draft-snapshot-"));
  const db = join(dir, "catalog.sqlite3");
  try {
    const created = spawnSync("/usr/bin/sqlite3", [db], {
      input: `${SNAPSHOT_SCHEMA}\n${setupSql}\n`,
      encoding: "utf8",
    });
    assert.equal(created.status, 0, created.stderr);
    const snap = spawnSync("/usr/bin/sqlite3", ["-readonly", "-bail", db], {
      input: draftSnapshotSql(rehearsal),
      encoding: "utf8",
    });
    return snap;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("draft snapshot executes against one draft without an id column", () => {
  const snap = runDraftSnapshot(`
    INSERT INTO slice_drafts (id, revision, region_start, region_end) VALUES (7, 2, '44100', '132300');
    INSERT INTO slice_draft_markers VALUES (7, 0, 'm0', '44100', 1, 0, 'c0', 'atk0');
    INSERT INTO slice_draft_markers VALUES (7, 1, 'm1', '132300', 0, 1, NULL, NULL);
  `);
  assert.equal(snap.status, 0, snap.stderr);
  assert.equal(
    snap.stdout,
    ["2|44100|132300", "2", "1", "44100", "132300", "7|0|m0|44100|1|0|c0|atk0", "7|1|m1|132300|0|1||", ""].join("\n"),
  );
});

test("draft snapshot contains the latest draft markers only", () => {
  const snap = runDraftSnapshot(`
    INSERT INTO slice_drafts (id, revision, region_start, region_end) VALUES (1, 1, '1', '2');
    INSERT INTO slice_drafts (id, revision, region_start, region_end) VALUES (9, 4, '176400', '220500');
    INSERT INTO slice_draft_markers VALUES (1, 0, 'old-marker', '1', 0, 0, NULL, NULL);
    INSERT INTO slice_draft_markers VALUES (9, 0, 'latest-marker', '176400', 1, 0, 'cand', NULL);
  `);
  assert.equal(snap.status, 0, snap.stderr);
  assert.match(snap.stdout, /latest-marker/);
  assert.doesNotMatch(snap.stdout, /old-marker/);
  assert.equal(snap.stdout.split("\n")[0], "4|176400|220500");
  assert.equal(snap.stdout.split("\n")[1], "1");
});

test("draft snapshot keeps latest rows when ordinals collide across drafts", () => {
  const setup = `
    INSERT INTO slice_drafts (id, revision, region_start, region_end) VALUES (3, 1, '10', '20');
    INSERT INTO slice_drafts (id, revision, region_start, region_end) VALUES (8, 5, '30', '40');
    INSERT INTO slice_draft_markers VALUES (3, 1, 'old-b', '20', 0, 0, NULL, NULL);
    INSERT INTO slice_draft_markers VALUES (3, 0, 'old-a', '10', 0, 0, NULL, NULL);
    INSERT INTO slice_draft_markers VALUES (8, 1, 'new-b', '400', 0, 1, NULL, NULL);
    INSERT INTO slice_draft_markers VALUES (8, 0, 'new-a', '300', 1, 0, NULL, NULL);
  `;
  const first = runDraftSnapshot(setup);
  const second = runDraftSnapshot(setup);
  assert.equal(first.status, 0, first.stderr);
  const expected = ["5|30|40", "2", "1", "300", "400", "8|0|new-a|300|1|0||", "8|1|new-b|400|0|1||", ""].join("\n");
  assert.equal(first.stdout, expected);
  assert.equal(second.stdout, expected);
  assert.doesNotMatch(first.stdout, /old-a|old-b/);
});

test("draft snapshot allows a latest draft with no markers", () => {
  const snap = runDraftSnapshot(`
    INSERT INTO slice_drafts (id, revision, region_start, region_end) VALUES (4, 1, '0', '10');
    INSERT INTO slice_drafts (id, revision, region_start, region_end) VALUES (11, 6, '50', '60');
    INSERT INTO slice_draft_markers VALUES (4, 0, 'stale', '50', 0, 0, NULL, NULL);
  `);
  assert.equal(snap.status, 0, snap.stderr);
  assert.equal(snap.stdout, "6|50|60\n0\n0\n");
  assert.doesNotMatch(snap.stdout, /stale/);
});
