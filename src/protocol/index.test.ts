import { fromHex, parseTelemetry, parseTrip } from "./index";

// The vector from swet-heart's blep.rs `telemetry_layout` test (v3 adds the
// pack voltage, 54.30 V = 5430 = 0x1536), so app and firmware agree on the layout.
const V2 = "02230156044e031905" + "00" + "d2040000";
const TELEMETRY = "03" + V2.slice(2) + "3615";

describe("parseTelemetry", () => {
  it("decodes the firmware's test vector", () => {
    expect(parseTelemetry(fromHex(TELEMETRY))).toEqual({
      speedKmh: 29.1,
      powerW: 1110,
      batteryPct: 78,
      pas: 3,
      speedLimit: 25,
      sport: false,
      lights: true,
      walk: false,
      motorLink: true,
      error: null,
      odoKm: 123.4,
      packV: 54.3,
    });
  });

  it("reads 0 V as not measured", () => {
    const b = fromHex(TELEMETRY);
    b[14] = 0;
    b[15] = 0;
    expect(parseTelemetry(b).packV).toBeNull();
    b[14] = 0x01;
    expect(parseTelemetry(b).packV).toBe(0.01);
  });

  it("still reads v2 telemetry, without pack voltage", () => {
    const t = parseTelemetry(fromHex(V2));
    expect(t.packV).toBeNull();
    expect(t).toEqual({ ...parseTelemetry(fromHex(TELEMETRY)), packV: null });
  });

  it("knows sport, unknown battery, error codes and link loss", () => {
    const b = fromHex(TELEMETRY);
    b[7] = 99;
    b[5] = 0xff;
    b[9] = 0x21;
    let t = parseTelemetry(b);
    expect(t.sport).toBe(true);
    expect(t.batteryPct).toBeNull();
    expect(t.error).toBe("21");
    b[9] = 0x0a;
    expect(parseTelemetry(b).error).toBe("0A");
    b[9] = 0xff;
    b[8] = 0b010;
    t = parseTelemetry(b);
    expect(t.error).toBe("link");
    expect(t.walk).toBe(true);
    expect(t.motorLink).toBe(false);
  });

  it("rejects wrong length for the version, or an unknown version", () => {
    expect(() => parseTelemetry(fromHex(TELEMETRY.slice(0, -2)))).toThrow(/15 bytes, expected 16/);
    expect(() => parseTelemetry(fromHex(TELEMETRY + "00"))).toThrow(/17 bytes, expected 16/);
    expect(() => parseTelemetry(fromHex(V2 + "3615"))).toThrow(/16 bytes, expected 14/);
    expect(() => parseTelemetry(fromHex(V2.slice(0, -2)))).toThrow(/13 bytes, expected 14/);
    expect(() => parseTelemetry(fromHex("03" + V2.slice(2)))).toThrow(/14 bytes, expected 16/);
    expect(() => parseTelemetry(fromHex("01" + V2.slice(2)))).toThrow(/version/);
    expect(() => parseTelemetry(fromHex("04" + TELEMETRY.slice(2)))).toThrow(/version/);
    expect(() => parseTelemetry(new Uint8Array(0))).toThrow(/version/);
  });
});

describe("parseTrip", () => {
  it("decodes a battery-trip record", () => {
    // blep.rs `trip_layout`: 36 km in 1 h, max 41.2, 7850 mAh
    const hex = "0101" + "a08c0000" + "9c01" + "6801" + "aa1e0000" + "100e0000";
    expect(parseTrip(fromHex(hex))).toEqual({
      id: "battery",
      km: 36,
      maxKmh: 41.2,
      avgKmh: 36,
      ah: 7.85,
      movingS: 3600,
    });
  });

  it("rejects unknown ids", () => {
    const hex = "0109" + "00".repeat(16);
    expect(() => parseTrip(fromHex(hex))).toThrow(/unknown id/);
  });
});

describe("fromHex", () => {
  it("rejects junk", () => {
    expect(() => fromHex("abc")).toThrow();
    expect(() => fromHex("zz")).toThrow();
  });
});
