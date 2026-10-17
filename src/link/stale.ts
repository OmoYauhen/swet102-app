import { Telemetry } from "../protocol";

/**
 * The last telemetry, kept after a disconnect: battery and pack voltage, assist,
 * lights and the odometer stay as they were; the bike isn't moving or pulling power any more.
 */
export function stale(t: Telemetry | null): Telemetry | null {
  return t && { ...t, speedKmh: 0, powerW: 0, walk: false, motorLink: false, error: null };
}

/** "21:47", or "12 Oct 21:47" when it wasn't today. */
export function lastSeen(at: number, now: Date = new Date()): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return hm;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${d.getDate()} ${month} ${hm}`;
}
