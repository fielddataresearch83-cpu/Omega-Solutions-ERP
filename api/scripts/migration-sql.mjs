/**
 * Remove transaction-control statements that would escape the transaction
 * owned by migrate.mjs. The original SQL must still be used for checksums.
 * This scanner only treats semicolons outside SQL strings, identifiers,
 * comments, dollar-quoted bodies and parentheses as statement boundaries.
 */
export function stripTopLevelTransactionWrappers(sql) {
  const statements = [];
  let start = 0;
  let i = 0;
  let state = 'normal';
  let dollarTag = '';
  let blockDepth = 0;
  let escapeString = false;
  let parenDepth = 0;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    if (state === 'single') {
      if (char === "'" && next === "'") { i += 2; continue; }
      if (char === "'") state = 'normal';
      else if (escapeString && char === '\\' && i + 1 < sql.length) i += 2;
      else i += 1;
      continue;
    }
    if (state === 'double') {
      if (char === '"' && next === '"') { i += 2; continue; }
      if (char === '"') state = 'normal';
      i += 1;
      continue;
    }
    if (state === 'line-comment') {
      if (char === '\n') state = 'normal';
      i += 1;
      continue;
    }
    if (state === 'block-comment') {
      if (char === '/' && next === '*') { blockDepth += 1; i += 2; continue; }
      if (char === '*' && next === '/') {
        blockDepth -= 1;
        i += 2;
        if (blockDepth === 0) state = 'normal';
        continue;
      }
      i += 1;
      continue;
    }
    if (state === 'dollar') {
      if (sql.startsWith(dollarTag, i)) {
        i += dollarTag.length;
        state = 'normal';
      } else i += 1;
      continue;
    }

    if (char === '-' && next === '-') { state = 'line-comment'; i += 2; continue; }
    if (char === '/' && next === '*') { state = 'block-comment'; blockDepth = 1; i += 2; continue; }
    if (char === "'") {
      const prefix = sql[i - 1];
      const beforePrefix = sql[i - 2];
      escapeString = (prefix === 'e' || prefix === 'E') && (!beforePrefix || !/[A-Za-z0-9_$]/.test(beforePrefix));
      state = 'single';
      i += 1;
      continue;
    }
    if (char === '"') { state = 'double'; i += 1; continue; }
    if (char === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) { dollarTag = match[0]; state = 'dollar'; i += dollarTag.length; continue; }
    }
    if (char === '(') parenDepth += 1;
    else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (char === ';' && parenDepth === 0) {
      statements.push(sql.slice(start, i + 1));
      start = i + 1;
    }
    i += 1;
  }
  if (start < sql.length) statements.push(sql.slice(start));

  const removeComments = (statement) => {
    let output = '';
    let mode = 'normal';
    let depth = 0;
    let tag = '';
    for (let cursor = 0; cursor < statement.length;) {
      const char = statement[cursor];
      const next = statement[cursor + 1];
      if (mode === 'line') {
        if (char === '\n') { output += ' '; mode = 'normal'; }
        cursor += 1;
        continue;
      }
      if (mode === 'block') {
        if (char === '/' && next === '*') { depth += 1; cursor += 2; continue; }
        if (char === '*' && next === '/') { depth -= 1; cursor += 2; if (!depth) { mode = 'normal'; output += ' '; } continue; }
        cursor += 1;
        continue;
      }
      if (mode === 'single' || mode === 'double' || mode === 'dollar') {
        const close = mode === 'single' ? "'" : mode === 'double' ? '"' : tag;
        if (statement.startsWith(close, cursor)) {
          output += close;
          cursor += close.length;
          if (mode !== 'dollar' && statement[cursor] === close) { output += close; cursor += 1; }
          else mode = 'normal';
        } else { output += char; cursor += 1; }
        continue;
      }
      if (char === '-' && next === '-') { mode = 'line'; cursor += 2; continue; }
      if (char === '/' && next === '*') { mode = 'block'; depth = 1; cursor += 2; continue; }
      if (char === "'") { mode = 'single'; output += char; cursor += 1; continue; }
      if (char === '"') { mode = 'double'; output += char; cursor += 1; continue; }
      if (char === '$') {
        const match = statement.slice(cursor).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
        if (match) { tag = match[0]; mode = 'dollar'; output += tag; cursor += tag.length; continue; }
      }
      output += char;
      cursor += 1;
    }
    return output;
  };
  const isWrapper = (statement) => {
    const withoutComments = removeComments(statement).replace(/;\s*$/, '').trim();
    return /^(?:BEGIN|COMMIT)(?:\s+(?:WORK|TRANSACTION))?$/i.test(withoutComments);
  };

  const withoutStandaloneWrappers = statements.filter((statement) => !isWrapper(statement)).join('');
  // A final/initial wrapper is also checked against the whole file. This guards
  // against trailing whitespace/comments being grouped with the final token.
  return withoutStandaloneWrappers
    .replace(/^\s*BEGIN(?:\s+(?:WORK|TRANSACTION))?\s*;\s*/i, '')
    .replace(/\s*COMMIT(?:\s+(?:WORK|TRANSACTION))?\s*;\s*$/i, '\n');
}

export async function applyMigrationTransaction(client, filename, sql, checksum) {
  await client.query('BEGIN');
  try {
    await client.query(stripTopLevelTransactionWrappers(sql));
    await client.query(
      'INSERT INTO omega_schema_migrations (filename, checksum) VALUES ($1, $2)',
      [filename, checksum],
    );
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}
