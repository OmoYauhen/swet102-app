import { demoLogBetween, demoTelemetry } from "./demo";

describe("demo telemetry", () => {
  const loop = Array.from({ length: 180 * 4 }, (_, i) => demoTelemetry(i / 4));

  it("stays within what the display can report", () => {
    for (const t of loop) {
      expect(t.speedKmh).toBeGreaterThanOrEqual(0);
      expect(t.powerW).toBeLessThanOrEqual(750);
      expect(t.pas).toBeGreaterThanOrEqual(1);
      expect(t.pas).toBeLessThanOrEqual(5);
      expect(t.batteryPct).toBeGreaterThanOrEqual(5);
      expect(t.batteryPct).toBeLessThanOrEqual(82);
    }
  });

  it("visits every dashboard state", () => {
    expect(loop.some((t) => t.walk)).toBe(true);
    expect(loop.some((t) => t.error === "link" && !t.motorLink)).toBe(true);
    expect(loop.some((t) => t.sport) && loop.some((t) => !t.sport)).toBe(true);
    expect(loop.some((t) => t.lights) && loop.some((t) => !t.lights)).toBe(true);
    expect(loop.some((t) => t.speedKmh > t.speedLimit)).toBe(true);
  });

  it("logs each gate press once, whatever the tick", () => {
    let prev = 0;
    let n = 0;
    for (let s = 0.5; s <= 100; s += 0.5) {
      if (demoLogBetween(prev, s)) n++;
      prev = s;
    }
    expect(n).toBe(2);
  });
});
