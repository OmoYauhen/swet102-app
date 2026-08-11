import { Telemetry } from "./types";

/** Where the connection to the device currently is. */
export type ConnectionState =
  | "disconnected"
  | "scanning"
  | "connecting"
  | "connected"
  | "error";

/**
 * A source of live telemetry, independent of HOW it is obtained.
 *
 * The UI depends only on this interface, never on `react-native-ble-plx`, so the
 * real BLE source and the simulated one are interchangeable.
 *
 * The subscribe methods return an *unsubscribe* function: a React screen calls
 * them inside `useEffect` and returns the unsubscribe as the cleanup, so
 * listeners don't leak when the screen unmounts.
 */
export interface TelemetrySource {
  /**
   * Begin connecting. Resolves once the attempt has STARTED — progress and the
   * final outcome are reported through {@link onStateChange}, not the promise.
   */
  connect(): Promise<void>;
  /** Tear down: stop emitting and drop the connection. */
  disconnect(): Promise<void>;
  /** The latest known connection state. */
  getState(): ConnectionState;
  /** Subscribe to decoded telemetry frames. Returns an unsubscribe function. */
  onTelemetry(listener: (frame: Telemetry) => void): () => void;
  /** Subscribe to connection-state changes. Returns an unsubscribe function. */
  onStateChange(listener: (state: ConnectionState) => void): () => void;
}
