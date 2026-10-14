// Activity report on the plugin-registry request.
//
// Voiden counts active installs without identifying any of them. The app keeps
// two dates in its own settings (first run, last reported day) and, on its
// first registry request of a day, tells voiden.md that it is active today and
// which day it was last active before that. From those two facts the server
// can count each install once in any date range: an install's first report
// inside a range is the one whose previous active day falls before the range.
// The report also carries an install code (installCode.ts), a one-way hash of
// the machine id, so a machine whose app data was cleared is not counted as a
// second install. Without it (turned off, or unreadable) the dates alone decide.

export interface ActivityState {
  /** UTC day (YYYY-MM-DD) of the first run. Absent for installs that predate activity counting. */
  first_seen?: string;
  /** UTC day (YYYY-MM-DD) last reported to voiden.md. */
  last_active?: string;
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function ageBucket(firstSeen: string | undefined, today: string): string {
  if (!firstSeen) return "unknown";
  const days = Math.floor((Date.parse(today) - Date.parse(firstSeen)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return "unknown";
  if (days < 7) return "lt7d";
  if (days < 30) return "lt30d";
  if (days < 180) return "lt180d";
  return "gte180d";
}

/**
 * Headers for the registry request, or {} when today was already reported.
 *   X-Voiden-Active       day, or day,ever on a fresh install's first report
 *   X-Voiden-Install-Age  lt7d | lt30d | lt180d | gte180d | unknown
 *   X-Voiden-Last-Active  UTC day (YYYY-MM-DD) of the previous report; absent on the first
 */
export function activityHeaders(state: ActivityState, now: Date): Record<string, string> {
  const today = utcDay(now);
  const last = state.last_active;
  if (last === today) return {};

  const headers: Record<string, string> = {
    // "ever" only for a fresh install: one that predates activity counting has
    // no first_seen and is reported as an existing install of unknown age.
    "X-Voiden-Active": !last && state.first_seen ? "day,ever" : "day",
    "X-Voiden-Install-Age": ageBucket(state.first_seen, today),
  };
  // A last day after today means the clock moved back; it says nothing useful.
  if (last && last < today) headers["X-Voiden-Last-Active"] = last;
  return headers;
}
