import type { DfuEvent } from "../../modules/swet-link";

/**
 * Pure logic of the OTA tab: firmware build numbers, the bootloader's version
 * check, and what a DFU event means for the screen.
 *
 * A build is swet102's VERSION_NUM: YYMMDDHH in UTC (e.g. 26101610 =
 * 2026-10-16 10:00 UTC). It is the init packet's fw_version in the release
 * zip and the display's DIS Software Revision string. The bootloader refuses
 * a package whose fw_version isn't greater than the installed one.
 */

/** A build from its DIS string; null for "-", empty or anything not YYMMDDHH. */
export function parseBuild(s: string | null | undefined): number | null {
  if (!s || !/^\d{8}$/.test(s.trim())) return null;
  return Number(s.trim());
}

/** The UTC date a build number stands for, or null if it isn't a YYMMDDHH date. */
export function buildDate(n: number): Date | null {
  if (!Number.isInteger(n) || n < 0 || n > 99_99_99_99) return null;
  const yy = Math.floor(n / 1_000_000);
  const mm = Math.floor(n / 10_000) % 100;
  const dd = Math.floor(n / 100) % 100;
  const hh = n % 100;
  if (mm < 1 || mm > 12 || dd < 1 || hh > 23) return null;
  const d = new Date(Date.UTC(2000 + yy, mm - 1, dd, hh));
  return d.getUTCDate() === dd ? d : null; // rejects 31 Feb and friends
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "26101610 · 2026-10-16 10:00 UTC", or just the number if it isn't a date. */
export function formatBuild(n: number): string {
  const d = buildDate(n);
  if (!d) return String(n);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return `${n} · ${date} ${pad(d.getUTCHours())}:00 UTC`;
}

/** "46.6 KB" */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type Comparison = "newer" | "same" | "older" | "unknown";

export function compareBuild(zip: number, installed: number | null): Comparison {
  if (installed === null) return "unknown";
  return zip > installed ? "newer" : zip === installed ? "same" : "older";
}

export interface Verdict {
  comparison: Comparison;
  /** Whether to offer the Update button. */
  canUpdate: boolean;
  text: string;
}

/**
 * What the bootloader will make of this zip, given the display's last known
 * build (`displayBuild` from the link: a DIS string, "-" or null).
 */
export function verdict(zipBuild: number, displayBuild: string | null): Verdict {
  const installed = parseBuild(displayBuild);
  const comparison = compareBuild(zipBuild, installed);
  switch (comparison) {
    case "newer":
      return { comparison, canUpdate: true, text: `Newer than the display's ${formatBuild(installed!)}.` };
    case "same":
      return {
        comparison,
        canUpdate: false,
        text:
          "The display already runs this build. Its bootloader only accepts a newer one, " +
          "so it would refuse this update.",
      };
    case "older":
      return {
        comparison,
        canUpdate: false,
        text:
          `Older than the display's ${formatBuild(installed!)}. Its bootloader only accepts ` +
          "a newer build, so it would refuse this update.",
      };
    case "unknown":
      return {
        comparison,
        canUpdate: true,
        text:
          displayBuild === "-"
            ? "The display runs a development build with no build number, so the app can't " +
              "compare. The bootloader refuses the update if it isn't newer."
            : "The display's build is unknown (its firmware doesn't report one, or the app " +
              "hasn't been connected to it yet). The bootloader refuses the update if it isn't newer.",
      };
  }
}

// ---- the update itself ----

export type Run =
  | { phase: "idle" }
  | { phase: "running"; label: string; percent: number | null }
  | { phase: "done" }
  | { phase: "aborted" }
  | { phase: "failed"; error: string; hint: string | null };

const LABELS: Record<string, string> = {
  connecting: "Connecting to SW102_DFU…",
  starting: "Starting the update…",
  uploading: "Sending the firmware…",
  validating: "The display is checking the firmware…",
  disconnecting: "Finishing…",
};

export const DONE_TEXT = "Done. Turn the display off, then on with a long PWR press.";

/** A hint for errors that have a usual cause. */
export function errorHint(error: string): string | null {
  if (/OPERATION FAILED/i.test(error)) {
    return (
      "OPERATION FAILED at the init packet usually means the firmware isn't newer than " +
      "the one on the display: the bootloader only accepts a higher build number."
    );
  }
  if (/GATT|disconnect|133|connection/i.test(error)) {
    return "Keep the phone close to the display. If it's still SW102_DFU, try again.";
  }
  return null;
}

/** The screen state after an onDfu event. */
export function runFromEvent(e: DfuEvent): Run {
  switch (e.stage) {
    case "completed":
      return { phase: "done" };
    case "aborted":
      return { phase: "aborted" };
    case "error": {
      const error = e.error || "Unknown error";
      return { phase: "failed", error, hint: errorHint(error) };
    }
    default:
      return {
        phase: "running",
        label: LABELS[e.stage] ?? e.stage,
        percent: e.stage === "uploading" ? Math.max(0, Math.min(100, e.percent ?? 0)) : null,
      };
  }
}

// ---- looking for the bootloader ----

/** One scan lasts this long at most (it ends at the first sighting). */
export const SCAN_WINDOW_MS = 6_000;
/**
 * Scans start at most this often. Android ignores an app that starts more
 * than 5 scans in 30 s (results just stop coming), so stay well under that.
 */
export const SCAN_PERIOD_MS = 7_000;

/** How long to wait before the next scan, given when the last one started. */
export function nextScanDelay(lastStart: number, now: number): number {
  return Math.max(500, SCAN_PERIOD_MS - (now - lastStart));
}

/** A found bootloader older than this is shown as not found. */
export const SEEN_TTL_MS = 15_000;
