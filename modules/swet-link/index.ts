import { NativeModule, requireOptionalNativeModule } from "expo";

/** Connection state as the native service reports it. */
export type LinkState =
  | "off"
  | "no display paired"
  | "bluetooth off"
  | "waiting"
  | "connecting"
  | "connected";

export interface LogEntry {
  /** ms since epoch */
  at: number;
  kind: "command" | "gate";
  text: string;
  ok: boolean;
}

export interface Snapshot {
  state: LinkState;
  /** Latest raw telemetry value, hex; kept (and saved) across disconnects. */
  telemetry: string | null;
  /** ms since epoch when that telemetry arrived, 0 if none. */
  telemetryAt: number;
  /** Latest raw trip records, hex. */
  trips: string[];
  log: LogEntry[];
}

export interface LinkSettings {
  address: string | null;
  enabled: boolean;
  haUrl: string;
  haToken: string;
  gateAService: string;
  gateAEntity: string;
  gateBService: string;
  gateBEntity: string;
}

type Events = {
  onState(e: { state: LinkState }): void;
  onTelemetry(e: { hex: string; at: number }): void;
  onTrip(e: { hex: string }): void;
  onLog(e: LogEntry): void;
};

declare class SwetLinkModule extends NativeModule<Events> {
  getSnapshot(): Snapshot;
  getSettings(): LinkSettings;
  saveHomeAssistant(
    url: string,
    token: string,
    gateAService: string,
    gateAEntity: string,
    gateBService: string,
    gateBEntity: string,
  ): void;
  /** Scan for "swet102" and remember its address. Resolves null if not found. */
  pair(timeoutMs: number): Promise<string | null>;
  forget(): void;
  start(): void;
  stop(): void;
  /** Resolves null on success, else the reason. */
  testGate(which: "A" | "B"): Promise<string | null>;
  rebootToDfu(): boolean;
}

/** null where the native module doesn't exist (web, Expo Go, iOS). */
export const SwetLink = requireOptionalNativeModule<SwetLinkModule>("SwetLink");
