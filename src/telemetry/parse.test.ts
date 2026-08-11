import { parseTelemetry } from "./parse";

/** Build a Uint8Array from a hex string like "01 ff 00 …". */
function bytes(hex: string): Uint8Array {
  return new Uint8Array(hex.trim().split(/\s+/).map((h) => parseInt(h, 16)));
}

describe("parseTelemetry", () => {
  it("decodes a normal riding frame", () => {
    // version=1, speed=25.5, soc=82, power=350W, 48.6V, 7.2A,
    // temp=42, assist=3, brake=off, lights=on
    const t = parseTelemetry(
      bytes("01 FF 00 52 5E 01 E6 01 24 00 2A 03 00 01"),
    );
    expect(t.version).toBe(1);
    expect(t.speedKmh).toBeCloseTo(25.5);
    expect(t.batterySoc).toBe(82);
    expect(t.powerW).toBe(350);
    expect(t.voltsV).toBeCloseTo(48.6);
    expect(t.ampsA).toBeCloseTo(7.2);
    expect(t.motorTempC).toBe(42);
    expect(t.assistLevel).toBe(3);
    expect(t.braking).toBe(false);
    expect(t.lights).toBe(true);
  });

  it("handles regen (negative power) and sub-zero temperature", () => {
    // power_w = -150 (0xFF6A LE), motor_temp = -5 (0xFB), braking on.
    // Regression guard: signed fields must use getInt*, not getUint*.
    const t = parseTelemetry(
      bytes("01 00 00 5A 6A FF E6 01 00 00 FB 00 01 00"),
    );
    expect(t.powerW).toBe(-150);
    expect(t.motorTempC).toBe(-5);
    expect(t.braking).toBe(true);
  });

  it("rejects a truncated packet", () => {
    expect(() => parseTelemetry(bytes("01 FF 00"))).toThrow();
  });

  it("rejects an unknown packet version", () => {
    expect(() =>
      parseTelemetry(bytes("02 FF 00 52 5E 01 E6 01 24 00 2A 03 00 01")),
    ).toThrow();
  });
});
