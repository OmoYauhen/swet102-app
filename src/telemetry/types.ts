/**
 * The decoded telemetry frame the rest of the app works with.
 *
 * Everything here is already in human units (km/h, V, A, °C, %). The raw
 * fixed-point scaling that comes off the BLE wire (speed ×10, amps ×5, …) lives
 * ONLY in parse.ts — no other file should ever see a `_x10` value. Decoding the
 * wire format once, at the boundary, keeps the rest of the app in clean units.
 */
export interface Telemetry {
  /** Packet format version. Always 1 for now; guarded in the parser. */
  version: number;
  /** Wheel speed, km/h. */
  speedKmh: number;
  /** Battery state of charge, %. */
  batterySoc: number;
  /** Battery power, W. Signed — negative means regen braking feeds the pack. */
  powerW: number;
  /** Battery voltage, V. */
  voltsV: number;
  /** Battery current, A. */
  ampsA: number;
  /** Motor temperature, °C. Signed — can drop below zero in winter. */
  motorTempC: number;
  /** PAS / assist level. */
  assistLevel: number;
  /** True while the brake is engaged. */
  braking: boolean;
  /** True while the lights are on. */
  lights: boolean;
}

/**
 * Wire-format constants — these MUST match `telemetry_packet_t` in the firmware
 * (`src/sw102/ble_services.c`). If the firmware bumps the packet, bump here too.
 */
export const TELEMETRY_PACKET_SIZE = 14;
export const TELEMETRY_PACKET_VERSION = 1;
