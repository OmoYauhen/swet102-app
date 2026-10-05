/**
 * Decoders for the Swet102 display's GATT payloads (swet102 docs/TECH_DESIGN.md
 * §9.4). All little-endian. The native service hands values over as hex
 * strings; this is the only place that knows the byte layout.
 */

export const TELEMETRY_VERSION = 2;
export const TRIPS_VERSION = 1;

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

/** 14 bytes: version, speed×10, power W, soc, pas, limit, flags, error, odo (100 m). */
export function parseTelemetry(bytes: Uint8Array): Telemetry {
  const v = view(bytes, 14, TELEMETRY_VERSION, "telemetry");
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
