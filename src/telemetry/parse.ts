import {
  Telemetry,
  TELEMETRY_PACKET_SIZE,
  TELEMETRY_PACKET_VERSION,
} from "./types";

/**
 * Decode a raw 14-byte telemetry packet into a {@link Telemetry}.
 *
 * The packet is a packed, LITTLE-ENDIAN C struct (ARM Cortex-M0 is LE), so
 * every multi-byte read passes `true` for the DataView `littleEndian` arg.
 *
 * Layout (offset → field), from `telemetry_packet_t` in the firmware:
 *   0  u8   version
 *   1  i16  speed_x10     (÷10 → km/h)
 *   3  u8   soc           (%)
 *   4  i16  power_w       (W, signed)
 *   6  u16  volts_x10     (÷10 → V)
 *   8  u16  amps_x5       (÷5  → A)
 *   10 i8   motor_temp_c  (°C, signed)
 *   11 u8   assist_level
 *   12 u8   brake         (0/1)
 *   13 u8   lights        (0/1)
 */
export function parseTelemetry(bytes: Uint8Array): Telemetry {
  if (bytes.length < TELEMETRY_PACKET_SIZE) {
    throw new Error(
      `telemetry packet too short: got ${bytes.length}, need ${TELEMETRY_PACKET_SIZE}`,
    );
  }

  // Pass byteOffset + byteLength, not just bytes.buffer: a Uint8Array can be a
  // window into a larger ArrayBuffer (base64 decoders often return one), and
  // `new DataView(bytes.buffer)` would then read from the wrong place.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const version = view.getUint8(0);
  if (version !== TELEMETRY_PACKET_VERSION) {
    throw new Error(`unsupported telemetry version: ${version}`);
  }

  return {
    version,
    speedKmh: view.getInt16(1, true) / 10,
    batterySoc: view.getUint8(3),
    powerW: view.getInt16(4, true),
    voltsV: view.getUint16(6, true) / 10,
    ampsA: view.getUint16(8, true) / 5,
    motorTempC: view.getInt8(10),
    assistLevel: view.getUint8(11),
    braking: view.getUint8(12) !== 0,
    lights: view.getUint8(13) !== 0,
  };
}
