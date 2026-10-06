// Activity flags for the plugin-registry request.
//
// Voiden counts active installs without identifying any of them. The app keeps
// two dates in its own settings (first run, last counted day) and, on the first
// registry request of a day, tells voiden.md which periods this is the first
// request of: day, week, month, ever. The server adds those up. No id is
// generated, stored or sent, and the dates themselves never leave the machine:
// only the period flags, a rough install-age bucket, and the month/week the
// install was last active (so installs that stopped coming back can be counted).

export interface ActivityState {
  /** UTC day (YYYY-MM-DD) of the first run. Absent for installs that predate activity counting. */
  first_seen?: string;
  /** UTC day (YYYY-MM-DD) last reported to voiden.md. */
  last_active?: string;
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ISO 8601 week, e.g. "2026-W41". The week belongs to the year of its Thursday.
export function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
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
 *   X-Voiden-Active             periods this is the first request of: day[,week][,month][,ever]
 *   X-Voiden-Install-Age        lt7d | lt30d | lt180d | gte180d | unknown
 *   X-Voiden-Last-Active-Month  YYYY-MM of the previous report (absent on the first)
 *   X-Voiden-Last-Active-Week   YYYY-Www of the previous report (absent on the first)
 */
export function activityHeaders(state: ActivityState, now: Date): Record<string, string> {
  const today = utcDay(now);
  const last = state.last_active;
  if (last === today) return {};

  const periods = ["day"];
  if (!last || isoWeek(last) !== isoWeek(today)) periods.push("week");
  if (!last || last.slice(0, 7) !== today.slice(0, 7)) periods.push("month");
  // "ever" only for a fresh install: one that predates activity counting has
  // no first_seen and is reported as an existing install of unknown age.
  if (!last && state.first_seen) periods.push("ever");

  const headers: Record<string, string> = {
    "X-Voiden-Active": periods.join(","),
    "X-Voiden-Install-Age": ageBucket(state.first_seen, today),
  };
  if (last) {
    headers["X-Voiden-Last-Active-Month"] = last.slice(0, 7);
    headers["X-Voiden-Last-Active-Week"] = isoWeek(last);
  }
  return headers;
}
