/**
 * Decoders for the Swet102 display's GATT payloads (swet102 docs/TECH_DESIGN.md
 * §9.4). All little-endian. The native service hands values over as hex
 * strings; this is the only place that knows the byte layout.
 */

/** Telemetry version this app writes against; v2 (no pack voltage) is still read. */
export const TELEMETRY_VERSION = 3;
/** Telemetry length in bytes, per version this app understands. */
const TELEMETRY_LEN: Record<number, number> = { 2: 14, 3: 16 };
export const TRIPS_VERSION = 1;
/** Highest assist level the display sends (swet102 config.rs PAS_MAX). */
export const PAS_MAX = 9;

export interface Telemetry {
  speedKmh: number;
  powerW: number;
  /** null before the display's first battery reading. */
  batteryPct: number | null;
  pas: number;
  /** km/h; above 25 means sport mode. */
  speedLimit: number;
  sport: boolean;
  lights: boolean;
  walk: boolean;
  motorLink: boolean;
  /** null = no error; "link" = motor link lost; else the STATUS code in hex. */
  error: string | null;
  odoKm: number;
  /**
   * Pack voltage from the display's battery sense, in volts (10 mV steps).
   * null before the first reading, if implausible, or from a v2 display.
   */
  packV: number | null;
}

export type TripId = "trip" | "battery" | "ride" | "odometer";
export const TRIP_IDS: TripId[] = ["trip", "battery", "ride", "odometer"];

export interface Trip {
  id: TripId;
  km: number;
  maxKmh: number;
  /** 0 for the odometer. */
  avgKmh: number;
  ah: number;
  movingS: number;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error(`not hex: ${hex}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return out;
}

function view(bytes: Uint8Array, len: number, version: number, what: string): DataView {
  if (bytes.length !== len) {
    throw new Error(`${what}: ${bytes.length} bytes, expected ${len}`);
  }
  if (bytes[0] !== version) {
    throw new Error(`${what}: version ${bytes[0]}, expected ${version}`);
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * v3, 16 bytes: version, speed×10, power W, soc, pas, limit, flags, error,
 * odo (100 m), pack voltage (10 mV, 0 = not measured).
 * v2, 14 bytes: the same without the pack voltage (older display builds).
 */
export function parseTelemetry(bytes: Uint8Array): Telemetry {
  const version = bytes[0];
  const len = TELEMETRY_LEN[version];
  if (len === undefined) {
    throw new Error(`telemetry: version ${version}, expected ${Object.keys(TELEMETRY_LEN).join(" or ")}`);
  }
  const v = view(bytes, len, version, "telemetry");
  const cv = version >= 3 ? v.getUint16(14, true) : 0;
  const soc = v.getUint8(5);
  const flags = v.getUint8(8);
  const err = v.getUint8(9);
  const limit = v.getUint8(7);
  return {
    speedKmh: v.getUint16(1, true) / 10,
    powerW: v.getUint16(3, true),
    batteryPct: soc === 0xff ? null : soc,
    pas: v.getUint8(6),
    speedLimit: limit,
    sport: limit > 25,
    lights: (flags & 1) !== 0,
    walk: (flags & 2) !== 0,
    motorLink: (flags & 4) !== 0,
    error: err === 0 ? null : err === 0xff ? "link" : err.toString(16).toUpperCase().padStart(2, "0"),
    odoKm: v.getUint32(10, true) / 10,
    packV: cv === 0 ? null : cv / 100,
  };
}

/** 18 bytes: version, id, meters, max×10, avg×10, mAh, moving seconds. */
export function parseTrip(bytes: Uint8Array): Trip {
  const v = view(bytes, 18, TRIPS_VERSION, "trip");
  const id = TRIP_IDS[v.getUint8(1)];
  if (!id) throw new Error(`trip: unknown id ${v.getUint8(1)}`);
  return {
    id,
    km: v.getUint32(2, true) / 1000,
    maxKmh: v.getUint16(6, true) / 10,
    avgKmh: v.getUint16(8, true) / 10,
    ah: v.getUint32(10, true) / 1000,
    movingS: v.getUint32(14, true),
  };
}
