function normalizeTimestamp(value) {
  if (value.length === 8) return Number(`${value}000000`);
  if (value.length === 10) return Number(`${value}0000`);
  if (value.length === 12) return Number(`${value}00`);
  return Number(value);
}

function migrationKey(filename) {
  // Timestamped legacy migrations for numbered versions 010/011 carry their
  // intended sequence in the middle (e.g. 20261014190000_010_quotations.sql).
  const embeddedVersion = filename.match(/^(\d{14})_(\d{3})_/);
  if (embeddedVersion) {
    return [0, Number(embeddedVersion[2]), Number(embeddedVersion[1])];
  }

  const numbered = filename.match(/^(\d{3})_/);
  if (numbered) return [0, Number(numbered[1]), 0];

  // Newer date/timestamp migrations run after the numbered migration series,
  // ordered by normalized date/time regardless of whether the name contains
  // YYYYMMDD, YYYYMMDDHH, YYYYMMDDHHmm, or YYYYMMDDHHmmss.
  const timestamp = filename.match(/^(\d{8}|\d{10}|\d{12}|\d{14})_/);
  if (timestamp) return [1, normalizeTimestamp(timestamp[1]), 0];

  return [2, 0, 0];
}

export function compareMigrationNames(a, b) {
  const left = migrationKey(a);
  const right = migrationKey(b);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }

  // When duplicate numeric prefixes exist, establish base/foundation tables
  // before additive migrations. This preserves the existing workforce schema:
  // 024_workforce_foundation creates the canonical tables, then the
  // attendance-assignment migration adds indexes, RLS, and permissions.
  const aFoundation = /_foundation\.sql$/i.test(a);
  const bFoundation = /_foundation\.sql$/i.test(b);
  if (aFoundation !== bFoundation) return aFoundation ? -1 : 1;

  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Find unapplied migrations that precede already-applied migrations in the
 * current canonical order. Those gaps can indicate a legacy/incomplete
 * migration ledger; automatically running them may replay data-changing SQL.
 */
export function findMigrationLedgerGaps(sortedFiles, appliedFilenames) {
  const applied = new Set(appliedFilenames);
  let lastAppliedIndex = -1;
  for (let i = 0; i < sortedFiles.length; i += 1) {
    if (applied.has(sortedFiles[i])) lastAppliedIndex = i;
  }
  if (lastAppliedIndex < 0) return [];
  return sortedFiles.filter((filename, index) => index < lastAppliedIndex && !applied.has(filename));
}
