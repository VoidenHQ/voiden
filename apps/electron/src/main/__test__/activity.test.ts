import { describe, expect, it } from "vitest";
import { activityHeaders, isoWeek } from "../extension/activity";

const at = (day: string) => new Date(`${day}T10:00:00Z`);

describe("isoWeek", () => {
  it("assigns days around new year to the week of their Thursday", () => {
    expect(isoWeek("2026-10-06")).toBe("2026-W41");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2024-12-30")).toBe("2025-W01");
  });
});

describe("activityHeaders", () => {
  it("reports a fresh install as first ever", () => {
    expect(activityHeaders({ first_seen: "2026-10-06" }, at("2026-10-06"))).toEqual({
      "X-Voiden-Active": "day,week,month,ever",
      "X-Voiden-Install-Age": "lt7d",
    });
  });

  it("sends nothing once today has been reported", () => {
    expect(activityHeaders({ first_seen: "2026-10-01", last_active: "2026-10-06" }, at("2026-10-06"))).toEqual({});
  });

  it("flags only the periods that changed since the last report", () => {
    const state = { first_seen: "2026-08-01", last_active: "2026-10-05" };
    // Next day, same week and month.
    expect(activityHeaders(state, at("2026-10-06"))["X-Voiden-Active"]).toBe("day");
    // New week, same month.
    expect(activityHeaders(state, at("2026-10-12"))["X-Voiden-Active"]).toBe("day,week");
    // New month.
    expect(activityHeaders(state, at("2026-11-02"))).toEqual({
      "X-Voiden-Active": "day,week,month",
      "X-Voiden-Install-Age": "lt180d",
      "X-Voiden-Last-Active-Month": "2026-10",
      "X-Voiden-Last-Active-Week": "2026-W41",
    });
  });

  it("reports an install that predates activity counting as existing, not new", () => {
    expect(activityHeaders({}, at("2026-10-06"))).toEqual({
      "X-Voiden-Active": "day,week,month",
      "X-Voiden-Install-Age": "unknown",
    });
  });

  it("buckets install age", () => {
    const age = (first: string) => activityHeaders({ first_seen: first, last_active: "2026-10-05" }, at("2026-10-06"))["X-Voiden-Install-Age"];
    expect(age("2026-10-01")).toBe("lt7d");
    expect(age("2026-09-20")).toBe("lt30d");
    expect(age("2026-06-01")).toBe("lt180d");
    expect(age("2025-10-01")).toBe("gte180d");
    expect(age("2027-01-01")).toBe("unknown");
  });
});
