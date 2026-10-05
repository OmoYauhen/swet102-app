import { fromHex, parseTelemetry, parseTrip } from "./index";

// Byte-for-byte the vector from swet-heart's blep.rs `telemetry_layout` test,
// so app and firmware agree on the layout.
const TELEMETRY = "02230156044e031905" + "00" + "d2040000";

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
    });
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

  it("rejects wrong length or version", () => {
    expect(() => parseTelemetry(fromHex(TELEMETRY.slice(2)))).toThrow(/bytes/);
    expect(() => parseTelemetry(fromHex("01" + TELEMETRY.slice(2)))).toThrow(/version/);
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
