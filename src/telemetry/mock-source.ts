import { Telemetry } from "./types";
import { ConnectionState, TelemetrySource } from "./source";

/** How often the simulated device emits a frame. */
const EMIT_INTERVAL_MS = 250;

/**
 * A simulated telemetry source with no hardware behind it.
 *
 * It fabricates plausible, gently-varying telemetry on a timer so the UI can run
 * in a browser or simulator, or when the bike isn't around. It implements the
 * same {@link TelemetrySource} interface as the BLE source, so nothing
 * downstream can tell them apart.
 */
export class MockTelemetrySource implements TelemetrySource {
  private state: ConnectionState = "disconnected";
  private timer: ReturnType<typeof setInterval> | null = null;

  private tick = 0;
  private soc = 92;

  // A Set so an unsubscribe removes in O(1) and a listener added twice fires
  // once.
  private telemetryListeners = new Set<(frame: Telemetry) => void>();
  private stateListeners = new Set<(state: ConnectionState) => void>();

  async connect(): Promise<void> {
    if (this.state === "connected") return;
    this.setState("connected");
    this.timer = setInterval(() => {
      this.emit(this.nextFrame());
    }, EMIT_INTERVAL_MS);
  }

  async disconnect(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.setState("disconnected");
  }

  getState(): ConnectionState {
    return this.state;
  }

  onTelemetry(listener: (frame: Telemetry) => void): () => void {
    this.telemetryListeners.add(listener);
    return () => this.telemetryListeners.delete(listener);
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private setState(next: ConnectionState): void {
    this.state = next;
    this.stateListeners.forEach((listener) => listener(next));
  }

  private emit(frame: Telemetry): void {
    this.telemetryListeners.forEach((listener) => listener(frame));
  }

  /** Advance the simulation one step and return the next frame. */
  private nextFrame(): Telemetry {
    this.tick++;
    const t = this.tick;

    const speedKmh = Math.max(0, Math.sin(t / 8) * 20);
    this.soc = Math.max(0, this.soc - 0.02);
    const powerW = Math.round(20 * speedKmh);
    const voltsV = 48 - (92 - this.soc) * 0.1;

    return {
      version: 1,
      speedKmh,
      batterySoc: Math.round(this.soc),
      powerW,
      voltsV,
      ampsA: Math.max(0, powerW / voltsV),
      motorTempC: 35 + Math.round(speedKmh / 4),
      assistLevel: 3,
      braking: false,
      lights: true,
    };
  }
}
