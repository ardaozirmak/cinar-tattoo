// The rules of the click counters (spec §5.6) that the public beacon (api/track.js) and the panel's
// summary (admin/content-handlers.js) share: which day a click belongs to, which days the summary
// covers, and how often one IP may be counted. The queries are in db.js.
//
// Uses only Web APIs: it runs inside a Pages Function.

const DAY_MS = 24 * 60 * 60 * 1000;

// The summary covers today and the 29 days before it.
export const STATS_DAYS = 30;

// en-CA writes a date as YYYY-MM-DD. Istanbul is UTC+3 all year, so the day turns at 21:00 UTC.
const ISTANBUL_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The calendar day in Istanbul at `ms` (milliseconds since 1970), as YYYY-MM-DD: the day a click is counted on. */
export function istanbulDay(ms) {
  return ISTANBUL_DAY.format(ms);
}

/** The first day (YYYY-MM-DD, included) of the summary at `now` (milliseconds): the Istanbul day 29 days before today's. */
export function statsSinceDay(now) {
  return istanbulDay(now - (STATS_DAYS - 1) * DAY_MS);
}

/**
 * A limit on how often one key (an IP) may be used within a window of `windowMs`: at most `limit` uses
 * per window. It is kept in memory, so it is one isolate's own count: enough for a trend figure that
 * nobody gains anything from inflating, and it needs no database call.
 *
 * The window of a key starts at its first use and is never moved, not even by a refused use. A key
 * that is not used again costs memory for one window only: every call removes all the windows that are
 * over, so the map holds the keys of the last `windowMs` at most.
 */
export function createRateLimiter({ limit, windowMs }) {
  const windows = new Map(); // key -> { start, count }

  return {
    /** Counts one use of `key` at `now` (milliseconds): false when the key has used up its limit in this window. */
    take(key, now) {
      for (const [other, window] of windows) {
        if (now - window.start >= windowMs) windows.delete(other);
      }
      let window = windows.get(key);
      if (window === undefined) {
        window = { start: now, count: 0 };
        windows.set(key, window);
      }
      if (window.count >= limit) return false;
      window.count += 1;
      return true;
    },

    /** How many keys have a window now. */
    get size() {
      return windows.size;
    },
  };
}
