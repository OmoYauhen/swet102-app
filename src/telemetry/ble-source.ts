import { Platform, PermissionsAndroid } from "react-native";
import {
  BleManager,
  Device,
  State,
  Subscription,
  BleError,
  Characteristic,
  ConnectionPriority,
} from "react-native-ble-plx";
import { toByteArray } from "base64-js";
import { parseTelemetry } from "./parse";
import { Telemetry } from "./types";
import { ConnectionState, TelemetrySource } from "./source";

/** The name the firmware advertises (DEVICE_NAME in ble_services.c). */
const DEVICE_NAME = "swang-stodva";

/**
 * The custom telemetry service/characteristic (lowercase for ble-plx).
 *
 * IMPORTANT: this 128-bit service is deliberately NOT advertised — the firmware
 * only fits the 16-bit standard UUIDs (Battery, CSC) in the 31-byte scan
 * response. So we cannot scan filtered by this UUID; we scan for all devices,
 * match by NAME, and this service only appears after connecting and discovering.
 */
const TELEMETRY_SERVICE_UUID = "57430001-9a43-11e5-a58f-0002a5d5c51b";
const TELEMETRY_CHAR_UUID = "57430002-9a43-11e5-a58f-0002a5d5c51b";

/**
 * BLE implementation of {@link TelemetrySource}.
 *
 * Same public surface as MockTelemetrySource, so the UI is oblivious to which
 * one it's using. Frames are decoded by the shared {@link parseTelemetry}; this
 * class only handles getting raw bytes off the radio and into it.
 */
export class BleTelemetrySource implements TelemetrySource {
  private manager = new BleManager();
  private device: Device | null = null;
  private monitorSub: Subscription | null = null;
  private disconnectSub: Subscription | null = null;

  private state: ConnectionState = "disconnected";
  private telemetryListeners = new Set<(frame: Telemetry) => void>();
  private stateListeners = new Set<(state: ConnectionState) => void>();

  // ---- lifecycle ----

  async connect(): Promise<void> {
    // Guard against re-entry: connecting while already busy would start a second
    // scan and leak the first.
    if (this.state !== "disconnected" && this.state !== "error") return;

    if (!(await this.ensurePermissions())) {
      console.warn("[ble] permissions denied — cannot scan");
      this.setState("error");
      return;
    }
    await this.waitForPoweredOn();

    console.log(`[ble] scanning for "${DEVICE_NAME}"…`);
    this.setState("scanning");
    // null = scan for everything. We can't filter by the telemetry UUID (it's
    // not advertised), so we match on name inside the callback.
    this.manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        console.warn("[ble] scan error:", error.message);
        this.manager.stopDeviceScan();
        this.setState("error");
        return;
      }
      // The name can arrive as `name` (advertising data) or `localName` (scan
      // response), depending on which packet carried it — check both.
      const advertisedName = device?.name ?? device?.localName;
      if (device && advertisedName === DEVICE_NAME) {
        console.log(`[ble] found ${advertisedName} (${device.id}) — connecting`);
        this.manager.stopDeviceScan();
        void this.establish(device);
      }
    });
  }

  /** Connect to the matched device, discover the service, start notifications. */
  private async establish(device: Device): Promise<void> {
    try {
      this.setState("connecting");
      const connected = await device.connect();
      // Notifications come from characteristics we haven't discovered yet — this
      // populates the GATT table so monitorCharacteristicForService can find it.
      await connected.discoverAllServicesAndCharacteristics();
      this.device = connected;

      // Ask Android for the fastest connection interval it will grant. The
      // firmware asks for a slow 500–1000 ms interval (MIN/MAX_CONN_INTERVAL in
      // ble_services.c), which is the real source of the lag — but the phone is
      // the connection master, so this can help until the peripheral
      // renegotiates its slow preference back. Best-effort; Android only.
      if (Platform.OS === "android") {
        try {
          await connected.requestConnectionPriority(ConnectionPriority.High);
        } catch {
          // Not fatal — we just keep whatever interval was negotiated.
        }
      }

      // If the bike powers off or drifts out of range, reflect it in the UI.
      this.disconnectSub = connected.onDisconnected(() => {
        this.teardownConnection();
        this.setState("disconnected");
      });

      // The heart of it: subscribe to the telemetry characteristic. The firmware
      // pushes a packet on every update (CCCD notify), and each arrives here.
      this.monitorSub = connected.monitorCharacteristicForService(
        TELEMETRY_SERVICE_UUID,
        TELEMETRY_CHAR_UUID,
        (error: BleError | null, characteristic: Characteristic | null) => {
          if (error || !characteristic?.value) {
            if (error) console.warn("[ble] notify error:", error.message);
            return;
          }
          try {
            // ble-plx delivers the value as base64; decode to bytes and parse.
            this.emit(parseTelemetry(toByteArray(characteristic.value)));
          } catch {
            // A single malformed frame must not tear down the stream.
          }
        },
      );

      console.log("[ble] connected + subscribed to telemetry");
      this.setState("connected");
    } catch (e) {
      console.warn("[ble] connect failed:", e);
      this.teardownConnection();
      this.setState("error");
    }
  }

  async disconnect(): Promise<void> {
    this.manager.stopDeviceScan();
    this.teardownConnection();
    if (this.device) {
      try {
        await this.device.cancelConnection();
      } catch {
        // Already gone — fine.
      }
      this.device = null;
    }
    this.setState("disconnected");
  }

  getState(): ConnectionState {
    return this.state;
  }

  // ---- subscriptions (same contract as the mock) ----

  onTelemetry(listener: (frame: Telemetry) => void): () => void {
    this.telemetryListeners.add(listener);
    return () => this.telemetryListeners.delete(listener);
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  // ---- internals ----

  /** Remove the notification + disconnect subscriptions (but keep `device`). */
  private teardownConnection(): void {
    this.monitorSub?.remove();
    this.monitorSub = null;
    this.disconnectSub?.remove();
    this.disconnectSub = null;
  }

  private setState(next: ConnectionState): void {
    this.state = next;
    this.stateListeners.forEach((listener) => listener(next));
  }

  private emit(frame: Telemetry): void {
    this.telemetryListeners.forEach((listener) => listener(frame));
  }

  /** Resolve once the phone's Bluetooth adapter is actually on. */
  private async waitForPoweredOn(): Promise<void> {
    if ((await this.manager.state()) === State.PoweredOn) return;
    await new Promise<void>((resolve) => {
      // `true` emits the current state immediately, so we don't miss it.
      const sub = this.manager.onStateChange((s) => {
        if (s === State.PoweredOn) {
          sub.remove();
          resolve();
        }
      }, true);
    });
  }

  /**
   * Android needs runtime permission before it will scan. The set depends on
   * OS version: 12+ (API 31) uses the new BLUETOOTH_SCAN/CONNECT; older phones
   * gate BLE scanning behind fine location. iOS handles this via Info.plist.
   */
  private async ensurePermissions(): Promise<boolean> {
    if (Platform.OS !== "android") return true;
    const api = Platform.Version as number;
    const needed =
      api >= 31
        ? [
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          ]
        : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const result = await PermissionsAndroid.requestMultiple(needed);
    return needed.every(
      (p) => result[p] === PermissionsAndroid.RESULTS.GRANTED,
    );
  }
}
