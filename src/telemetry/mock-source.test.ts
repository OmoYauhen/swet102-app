import { MockTelemetrySource } from "./mock-source";
import { ConnectionState } from "./source";
import { Telemetry } from "./types";

// Fake timers let us fast-forward the emit interval without real waiting — the
// standard way to test anything on a setInterval/setTimeout in RN.
describe("MockTelemetrySource", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("connects and emits frames on a timer, then stops on disconnect", async () => {
    const src = new MockTelemetrySource();
    const states: ConnectionState[] = [];
    const frames: number[] = [];
    src.onStateChange((s) => states.push(s));
    src.onTelemetry((f) => frames.push(f.speedKmh));

    await src.connect();
    expect(src.getState()).toBe("connected");
    expect(states).toContain("connected");

    jest.advanceTimersByTime(1000); // ~4 frames at 250ms
    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(frames.every((v) => typeof v === "number")).toBe(true);

    await src.disconnect();
    const seen = frames.length;
    jest.advanceTimersByTime(1000);
    expect(frames.length).toBe(seen); // stopped: no new frames
    expect(src.getState()).toBe("disconnected");
  });

  it("unsubscribing stops delivery to that listener", async () => {
    const src = new MockTelemetrySource();
    const frames: number[] = [];
    const unsubscribe = src.onTelemetry((f) => frames.push(f.speedKmh));

    await src.connect();
    jest.advanceTimersByTime(500);
    const seen = frames.length;

    unsubscribe();
    jest.advanceTimersByTime(500);
    expect(frames.length).toBe(seen); // no delivery after unsubscribe

    await src.disconnect();
  });
});

describe("MockTelemetrySource — lively data", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** Connect, fast-forward `n` frames, and return every frame emitted. */
  function collect(n: number): Telemetry[] {
    const src = new MockTelemetrySource();
    const frames: Telemetry[] = [];
    src.onTelemetry((f) => frames.push(f));
    src.connect(); // work is synchronous, so no await under fake timers
    jest.advanceTimersByTime(n * 250 + 10);
    src.disconnect();
    return frames;
  }

  it("speed changes over time (not a frozen readout)", () => {
    const speeds = collect(40).map((f) => Math.round(f.speedKmh));
    // At least a few distinct values across 40 frames — proves it's evolving.
    expect(new Set(speeds).size).toBeGreaterThanOrEqual(3);
  });

  it("keeps every field in a physically sane range", () => {
    for (const f of collect(40)) {
      expect(f.version).toBe(1);
      expect(f.speedKmh).toBeGreaterThanOrEqual(0);
      expect(f.speedKmh).toBeLessThanOrEqual(80);
      expect(f.batterySoc).toBeGreaterThanOrEqual(0);
      expect(f.batterySoc).toBeLessThanOrEqual(100);
      expect(f.voltsV).toBeGreaterThan(20);
      expect(f.voltsV).toBeLessThan(70);
      expect(f.ampsA).toBeGreaterThanOrEqual(0);
      expect(f.motorTempC).toBeGreaterThan(-30);
      expect(f.motorTempC).toBeLessThan(150);
      expect(typeof f.braking).toBe("boolean");
      expect(typeof f.lights).toBe("boolean");
    }
  });
});
