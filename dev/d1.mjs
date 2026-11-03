// A Cloudflare D1 database over node:sqlite, for local development and tests. It implements
// the part of the D1 API the site uses: prepare().bind().first/all/run/raw, batch and exec.
//
// It follows D1 where the two differ from plain SQLite, so mistakes show up locally and not
// after a deploy: bind(undefined) throws D1_TYPE_ERROR, booleans bind as 1/0, one statement
// binds at most 100 values, batch() is a transaction, exec() runs one statement per line, and
// errors surface when a statement runs, not when it is prepared.
//
// The object it returns has plain own methods that do not use `this` (tests wrap it), plus
// close(), which real D1 has no use for: Windows cannot delete a database file that is still open.
//
// Known limits of this shim:
// - A statement with too few bound values runs with NULL for the rest; D1 refuses it.
// - raw() builds its arrays from the row objects, so a column name that appears twice
//   or that looks like an integer ("1") is not kept in query order.
// - BLOB columns come back as Uint8Array; D1 returns arrays of numbers.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inspect } from 'node:util';

const MAX_BOUND_VALUES = 100;

// changes() and last_insert_rowid() keep their value across statements that write nothing, so
// total_changes() tells whether the statement that just ran wrote anything.
const COUNTERS_SQL = 'SELECT total_changes() AS total, changes() AS changes, last_insert_rowid() AS last_row_id';

export function createD1(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const sqlite = new DatabaseSync(filename);
  const counters = sqlite.prepare(COUNTERS_SQL);
  // Every statement we hand out, so batch() can run them itself, synchronously.
  const statements = new WeakMap();
  let closed = false;

  // Runs one statement to completion. Synchronous on purpose: batch() relies on it.
  function execute(sql, params) {
    const started = performance.now();
    try {
      const statement = sqlite.prepare(sql);
      const totalBefore = counters.get().total;
      const rows = statement.all(...params);
      const after = counters.get();
      const wrote = after.total !== totalBefore;
      return {
        // node:sqlite rows have no prototype; D1 hands out plain objects.
        results: rows.map((row) => ({ ...row })),
        success: true,
        meta: {
          duration: performance.now() - started,
          changes: wrote ? after.changes : 0,
          last_row_id: wrote ? after.last_row_id : 0,
        },
      };
    } catch (error) {
      throw d1Error(error);
    }
  }

  function transaction(command) {
    try {
      sqlite.exec(command);
    } catch (error) {
      throw d1Error(error);
    }
  }

  function makeStatement(sql, params) {
    const statement = {
      // Returns a new statement and leaves this one unbound, as D1 does:
      // `db.batch(items.map((item) => insert.bind(item)))` depends on it.
      bind(...values) {
        if (values.length > MAX_BOUND_VALUES) {
          throw new Error(
            `D1_ERROR: too many SQL variables: ${values.length} values bound, D1 allows at most ${MAX_BOUND_VALUES} per statement`,
          );
        }
        return makeStatement(sql, values.map(toSqlValue));
      },

      async first(column) {
        const row = execute(sql, params).results[0] ?? null;
        if (column === undefined || row === null) return row;
        if (!Object.hasOwn(row, column)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
        return row[column];
      },

      async all() {
        return execute(sql, params);
      },

      // D1's run() and all() return the same thing; the names only say what the caller expects.
      async run() {
        return execute(sql, params);
      },

      async raw() {
        return execute(sql, params).results.map((row) => Object.values(row));
      },
    };
    statements.set(statement, { sql, params });
    return statement;
  }

  return {
    prepare(sql) {
      return makeStatement(sql, []);
    },

    // No `await` between BEGIN and COMMIT: any other query would otherwise run inside the transaction.
    async batch(stmts) {
      const queued = stmts.map((statement) => {
        const entry = statements.get(statement);
        if (!entry) throw new TypeError("D1 batch() only accepts statements created by this database's prepare().");
        return entry;
      });
      transaction('BEGIN');
      try {
        const results = queued.map(({ sql, params }) => execute(sql, params));
        transaction('COMMIT');
        return results;
      } catch (error) {
        try {
          transaction('ROLLBACK');
        } catch {
          // SQLite has already ended the transaction on its own; the original error matters more.
        }
        throw error;
      }
    },

    async exec(sql) {
      const started = performance.now();
      let count = 0;
      for (const [index, line] of String(sql).split('\n').entries()) {
        if (line.trim() === '') continue;
        try {
          sqlite.exec(line);
        } catch (error) {
          throw new Error(`D1_EXEC_ERROR: Error in line ${index + 1}: ${line.trim()}: ${error.message}`, { cause: error });
        }
        count += 1;
      }
      return { count, duration: performance.now() - started };
    },

    close() {
      if (closed) return;
      closed = true;
      sqlite.close();
    },
  };
}

function d1Error(error) {
  return new Error(`D1_ERROR: ${error.message}`, { cause: error });
}

function toSqlValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  // node:sqlite binds an ArrayBuffer, like any other object it does not know, as NULL.
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error(`D1_TYPE_ERROR: Type '${typeof value}' not supported for value '${inspect(value)}'`);
}
