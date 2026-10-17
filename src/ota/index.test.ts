import {
  buildDate,
  compareBuild,
  errorHint,
  formatBuild,
  formatSize,
  nextScanDelay,
  parseBuild,
  runFromEvent,
  SCAN_PERIOD_MS,
  verdict,
} from ".";

describe("build numbers", () => {
  it("reads the DIS Software Revision string", () => {
    expect(parseBuild("26101610")).toBe(26101610);
    expect(parseBuild(" 26101610 ")).toBe(26101610);
    expect(parseBuild("-")).toBeNull();
    expect(parseBuild("")).toBeNull();
    expect(parseBuild(null)).toBeNull();
    expect(parseBuild("0.1.0")).toBeNull();
    expect(parseBuild("2610161")).toBeNull();
  });

  it("formats YYMMDDHH as a UTC date", () => {
    expect(formatBuild(26101610)).toBe("26101610 · 2026-10-16 10:00 UTC");
    expect(formatBuild(26100400)).toBe("26100400 · 2026-10-04 00:00 UTC");
    expect(formatBuild(27010123)).toBe("27010123 · 2027-01-01 23:00 UTC");
  });

  it("shows anything that isn't a date as the plain number", () => {
    expect(buildDate(26131610)).toBeNull(); // month 13
    expect(buildDate(26023110)).toBeNull(); // 31 Feb
    expect(buildDate(26101624)).toBeNull(); // hour 24
    expect(formatBuild(42)).toBe("42");
  });

  it("formats sizes", () => {
    expect(formatSize(900)).toBe("900 B");
    expect(formatSize(47167)).toBe("46.1 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("version check", () => {
  it("compares like the bootloader (strictly newer)", () => {
    expect(compareBuild(26101702, 26101610)).toBe("newer");
    expect(compareBuild(26101610, 26101610)).toBe("same");
    expect(compareBuild(26100400, 26101610)).toBe("older");
    expect(compareBuild(26101610, null)).toBe("unknown");
  });

  it("offers the update only when it can work", () => {
    const newer = verdict(26101702, "26101610");
    expect(newer.canUpdate).toBe(true);
    expect(newer.text).toContain("2026-10-16 10:00 UTC");

    expect(verdict(26101610, "26101610")).toMatchObject({ comparison: "same", canUpdate: false });
    const older = verdict(26100400, "26101610");
    expect(older).toMatchObject({ comparison: "older", canUpdate: false });
    expect(older.text).toContain("refuse");
  });

  it("still offers it when the installed build is unknown, and says so", () => {
    for (const installed of [null, "-"]) {
      const v = verdict(26101610, installed);
      expect(v).toMatchObject({ comparison: "unknown", canUpdate: true });
      expect(v.text).toMatch(/can't compare|unknown/);
    }
  });
});

describe("DFU events", () => {
  it("shows progress while running", () => {
    expect(runFromEvent({ stage: "connecting" })).toEqual({
      phase: "running",
      label: "Connecting to SW102_DFU…",
      percent: null,
    });
    expect(runFromEvent({ stage: "uploading", percent: 42 })).toMatchObject({ phase: "running", percent: 42 });
    expect(runFromEvent({ stage: "uploading", percent: 140 })).toMatchObject({ percent: 100 });
  });

  it("ends in done, aborted or failed", () => {
    expect(runFromEvent({ stage: "completed", percent: 100 })).toEqual({ phase: "done" });
    expect(runFromEvent({ stage: "aborted" })).toEqual({ phase: "aborted" });
    const f = runFromEvent({ stage: "error", error: "OPERATION FAILED", errorType: "remote" });
    expect(f).toMatchObject({ phase: "failed", error: "OPERATION FAILED" });
    expect(f.phase === "failed" && f.hint).toMatch(/isn't newer/);
  });

  it("hints only where there's a usual cause", () => {
    expect(errorHint("GATT ERROR")).toMatch(/close/);
    expect(errorHint("INVALID OBJECT")).toBeNull();
  });
});

describe("scan cadence", () => {
  it("keeps scan starts at least a period apart", () => {
    expect(nextScanDelay(0, 1000)).toBe(SCAN_PERIOD_MS - 1000);
    expect(nextScanDelay(0, SCAN_PERIOD_MS + 5000)).toBe(500);
    // never more than 5 starts in 30 s (Android's limit)
    expect(30_000 / SCAN_PERIOD_MS).toBeLessThan(5);
  });
});
