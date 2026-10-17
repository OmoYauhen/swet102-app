import { Telemetry } from "../protocol";
import { lastSeen, stale } from "./stale";

const t: Telemetry = {
  speedKmh: 23.4,
  powerW: 416,
  batteryPct: 78,
  pas: 9,
  speedLimit: 25,
  sport: false,
  lights: true,
  walk: true,
  motorLink: true,
  error: "link",
  odoKm: 1234.5,
  packV: 54.3,
};

describe("stale telemetry", () => {
  it("keeps battery (and pack voltage), assist, lights and odometer; drops motion", () => {
    expect(stale(t)).toEqual({
      ...t,
      speedKmh: 0,
      powerW: 0,
      walk: false,
      motorLink: false,
      error: null,
    });
  });

  it("stays null without telemetry", () => {
    expect(stale(null)).toBeNull();
  });
});

describe("lastSeen", () => {
  const now = new Date(2026, 9, 13, 4, 10);

  it("shows only the time today", () => {
    expect(lastSeen(new Date(2026, 9, 13, 0, 5).getTime(), now)).toBe("00:05");
  });

  it("adds the date on another day", () => {
    expect(lastSeen(new Date(2026, 9, 12, 21, 47).getTime(), now)).toBe("12 Oct 21:47");
  });
});
