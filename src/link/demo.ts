/**
 * Fake telemetry for running without the display (emulator, web). Enabled at
 * bundle time with EXPO_PUBLIC_DEMO=1. A 90 s loop rides through every state
 * the dashboard has: assist levels, lights, a stop with walk assist, a motor
 * link drop, sport mode every other loop, and a draining battery.
 */

import { PAS_MAX, Telemetry, Trip } from "../protocol";

const LOOP_S = 90;
const AVG_KMH = 20;

function speedAt(s: number): number {
  const p = s % LOOP_S;
  if (p >= 80) return p >= 83 && p < 88 ? 4 : 0; // stopped, then walking it
  const v = 22 + 12 * Math.sin((2 * Math.PI * p) / 40) + 4 * Math.sin((2 * Math.PI * p) / 7);
  return Math.max(0, v * Math.min(1, p / 6)); // pull away from the stop
}

export function demoTelemetry(s: number): Telemetry {
  const p = s % LOOP_S;
  const sport = Math.floor(s / LOOP_S) % 2 === 1;
  const speedLimit = sport ? 45 : 25;
  const speedKmh = Math.round(speedAt(s) * 10) / 10;
  const walk = p >= 83 && p < 88;
  const pas = 1 + (Math.floor(s / 15) % PAS_MAX);
  const linkLost = p >= 60 && p < 63;
  const climbing = Math.max(0, speedAt(s + 0.5) - speedAt(s));
  const assisting = !linkLost && speedKmh > 0.5 && speedKmh < speedLimit;
  const powerW = walk ? 60 : assisting ? Math.round(Math.min(750, pas * 45 + climbing * 160)) : 0;
  return {
    speedKmh,
    powerW,
    batteryPct: 82 - (Math.floor(s / 12) % 78),
    pas,
    speedLimit,
    sport,
    lights: Math.floor(s / 30) % 2 === 0,
    walk,
    motorLink: !linkLost,
    error: linkLost ? "link" : null,
    odoKm: Math.round((1234.5 + (s * AVG_KMH) / 3600) * 10) / 10,
  };
}

export function demoTrips(s: number): Trip[] {
  const km = (s * AVG_KMH) / 3600;
  const trip = (id: Trip["id"], base: number, baseS: number): Trip => ({
    id,
    km: base + km,
    maxKmh: 41.2,
    avgKmh: id === "odometer" ? 0 : 21.3,
    ah: (base + km) * 0.24,
    movingS: baseS + Math.floor(s),
  });
  return [
    trip("ride", 0, 0),
    trip("trip", 85.1, 13_000),
    trip("battery", 31.7, 5_400),
    trip("odometer", 1234.5, 220_000),
  ];
}

/** A gate press every 45 s, alternating success and failure: the one after `prev`, up to `now`. */
export function demoLogBetween(prev: number, now: number): { text: string; ok: boolean } | null {
  const n = Math.floor(now / 45);
  if (n === Math.floor(prev / 45)) return null;
  return n % 2 === 1
    ? { text: "Gate A opened", ok: true }
    : { text: "Gate B: Home Assistant unreachable", ok: false };
}
