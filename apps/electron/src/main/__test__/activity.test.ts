import { describe, expect, it } from "vitest";
import { activityHeaders } from "../extension/activity";

const at = (day: string) => new Date(`${day}T10:00:00Z`);

describe("activityHeaders", () => {
  it("reports a fresh install as first ever", () => {
    expect(activityHeaders({ first_seen: "2026-10-06" }, at("2026-10-06"))).toEqual({
      "X-Voiden-Active": "day,ever",
      "X-Voiden-Install-Age": "lt7d",
    });
  });

  it("sends nothing once today has been reported", () => {
    expect(activityHeaders({ first_seen: "2026-10-01", last_active: "2026-10-06" }, at("2026-10-06"))).toEqual({});
  });

  it("reports the previous active day on a later day", () => {
    expect(activityHeaders({ first_seen: "2026-08-01", last_active: "2026-10-05" }, at("2026-11-02"))).toEqual({
      "X-Voiden-Active": "day",
      "X-Voiden-Install-Age": "lt180d",
      "X-Voiden-Last-Active": "2026-10-05",
    });
  });

  it("reports an install that predates activity counting as existing, not new", () => {
    expect(activityHeaders({}, at("2026-10-06"))).toEqual({
      "X-Voiden-Active": "day",
      "X-Voiden-Install-Age": "unknown",
    });
  });

  it("leaves out a last active day that is in the future", () => {
    expect(activityHeaders({ first_seen: "2026-10-01", last_active: "2026-10-09" }, at("2026-10-06"))).toEqual({
      "X-Voiden-Active": "day",
      "X-Voiden-Install-Age": "lt7d",
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

describe("hashMachineId", () => {
  it("is stable, case-insensitive and does not contain the machine id", async () => {
    const { hashMachineId } = await import("../extension/installCode");
    const id = "4C4C4544-0042-3010-8052-B4C04F4D3033";
    const code = hashMachineId(id);
    expect(code).toMatch(/^[0-9a-f]{32}$/);
    expect(hashMachineId(` ${id.toLowerCase()}\n`)).toBe(code);
    expect(hashMachineId("another-machine")).not.toBe(code);
    expect(code).not.toContain("4c4c4544");
    expect(hashMachineId("")).toBe("");
  });
});
