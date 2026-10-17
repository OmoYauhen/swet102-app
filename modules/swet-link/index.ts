import { NativeModule, requireOptionalNativeModule } from "expo";

/** Connection state as the native service reports it. */
export type LinkState =
  | "off"
  | "no display paired"
  | "bluetooth off"
  | "waiting"
  | "connecting"
  | "connected"
  /** A firmware update owns the display (the link lets go until it ends). */
  | "paused";

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
  /**
   * The display's build (DIS Software Revision: VERSION_NUM, YYMMDDHH UTC, e.g.
   * "26101610"; "-" for a non-make build) as last read on connect, or as last
   * installed from the OTA tab. null if its firmware doesn't publish one.
   */
  displayBuild: string | null;
  /** DIS Firmware Revision (semver, e.g. "0.1.0") as last read; null if unknown. */
  displayVersion: string | null;
}

/** A DFU zip (nrfutil package) as read from its manifest and init packet. */
export interface FirmwareInfo {
  /** File name, as the document provider knows it. */
  name: string;
  /** Bytes of the zip. */
  size: number;
  /** Init packet fw_version: VERSION_NUM, YYMMDDHH (UTC). */
  fwVersion: number;
  hwVersion: number;
  sdReq: number[];
  /** Bytes of the application image. */
  appSize: number;
  /** Only application packages are accepted. */
  type: "application";
  signed: boolean;
}

export type DfuStage =
  | "connecting"
  | "starting"
  | "uploading"
  | "validating"
  | "disconnecting"
  | "completed"
  | "aborted"
  | "error";

export interface DfuEvent {
  stage: DfuStage;
  /** 0–100 while uploading. */
  percent?: number;
  /** For stage "error": the library's message, e.g. "OPERATION FAILED". */
  error?: string;
  /** "remote" when the bootloader refused, "communication" for BLE trouble. */
  errorType?: "remote" | "communication" | "other";
}

type Events = {
  onState(e: { state: LinkState }): void;
  onTelemetry(e: { hex: string; at: number }): void;
  onTrip(e: { hex: string }): void;
  onLog(e: LogEntry): void;
  onDfu(e: DfuEvent): void;
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

  /** Reads a DFU zip (content:// or file://); rejects with the reason it can't be used. */
  inspectFirmware(uri: string): Promise<FirmwareInfo>;
  /** One scan for the bootloader, "SW102_DFU"; resolves at the first sighting or null. */
  scanDfu(timeoutMs: number): Promise<{ address: string; rssi: number } | null>;
  /**
   * Updates the display at `address` (in its bootloader) with the zip at `uri`.
   * Progress comes as onDfu events; the link is paused until the update ends.
   * Throws if the zip is invalid or an update is already running.
   */
  startDfu(address: string, uri: string): void;
  abortDfu(): void;
  /** Whether an update runs, and its latest event (also after it ended). */
  getDfu(): { running: boolean; last: DfuEvent | null };
}

/** null where the native module doesn't exist (web, Expo Go, iOS). */
export const SwetLink = requireOptionalNativeModule<SwetLinkModule>("SwetLink");
