import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useTelemetry } from "../telemetry/use-telemetry";
import { TelemetrySource, ConnectionState } from "../telemetry/source";
import { Telemetry } from "../telemetry/types";

// Stock Bafang firmware doesn't report battery voltage, so the firmware can't
// compute watts (power = V × I) and sends 0. We derive an estimate at the UI
// layer from the real battery current and the pack's NOMINAL voltage — set this
// to YOUR battery (36 / 48 / 52 V…). The parser stays honest; this is a display
// convenience, not wire data.
const NOMINAL_PACK_VOLTAGE = 48;

function estimatedPowerW(frame: Telemetry): number {
  return Math.round(frame.ampsA * NOMINAL_PACK_VOLTAGE);
}

/**
 * The live dashboard. It knows nothing about BLE or the simulator — it takes a
 * TelemetrySource and renders whatever frames come out of it.
 */
export function DashboardScreen({ source }: { source: TelemetrySource }) {
  const { frame, connectionState } = useTelemetry(source);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>swang-stodva</Text>
      <StatusBadge state={connectionState} />

      {frame ? (
        <>
          {/* Hero speed readout */}
          <View style={styles.speedBlock}>
            <Text style={styles.speedValue}>{frame.speedKmh.toFixed(1)}</Text>
            <Text style={styles.speedUnit}>km/h</Text>
          </View>

          {/* Stat grid — flexWrap makes it reflow into rows */}
          <View style={styles.grid}>
            <Stat label="Battery" value={`${frame.batterySoc}%`} />
            {/* Voltage & Motor temp are hidden: stock Bafang firmware doesn't
                report them (they'd always read 0). Power is derived from
                current, not the wire's (zero) power field. */}
            <Stat label="Power" value={`~${estimatedPowerW(frame)} W`} />
            <Stat label="Current" value={`${frame.ampsA.toFixed(1)} A`} />
            <Stat label="Assist" value={`${frame.assistLevel}`} />
          </View>

          {/* Boolean flags */}
          <View style={styles.flags}>
            <Flag label="Brake" on={frame.braking} />
            <Flag label="Lights" on={frame.lights} />
          </View>
        </>
      ) : (
        <Text style={styles.waiting}>Waiting for telemetry…</Text>
      )}
    </ScrollView>
  );
}

/** A small labelled value tile. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** A pill that turns green when `on`. Conditional styles are just arrays:
 *  the later object wins, so the "on" style overrides the base. */
function Flag({ label, on }: { label: string; on: boolean }) {
  return (
    <View style={[styles.flag, on && styles.flagOn]}>
      <Text style={[styles.flagText, on && styles.flagTextOn]}>{label}</Text>
    </View>
  );
}

function StatusBadge({ state }: { state: ConnectionState }) {
  const color = state === "connected" ? "#22c55e" : "#eab308";
  return (
    <View style={styles.badge}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.badgeText}>{state}</Text>
    </View>
  );
}

// StyleSheet.create validates keys and lets RN cache style objects by id.
const styles = StyleSheet.create({
  container: { padding: 24, gap: 20, alignItems: "center" },
  title: { color: "#e5e7eb", fontSize: 22, fontWeight: "700", letterSpacing: 1 },

  badge: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  badgeText: { color: "#9ca3af", fontSize: 14, textTransform: "capitalize" },

  speedBlock: { alignItems: "center", marginTop: 8 },
  speedValue: { color: "#f9fafb", fontSize: 96, fontWeight: "800", lineHeight: 100 },
  speedUnit: { color: "#9ca3af", fontSize: 18, marginTop: -4 },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 12,
  },
  stat: {
    backgroundColor: "#1f2937",
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    minWidth: 100,
    alignItems: "center",
  },
  statValue: { color: "#f9fafb", fontSize: 24, fontWeight: "700" },
  statLabel: { color: "#9ca3af", fontSize: 13, marginTop: 4 },

  flags: { flexDirection: "row", gap: 12 },
  flag: {
    backgroundColor: "#1f2937",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  flagOn: { backgroundColor: "#065f46" },
  flagText: { color: "#6b7280", fontWeight: "600" },
  flagTextOn: { color: "#a7f3d0" },

  waiting: { color: "#9ca3af", fontSize: 16, marginTop: 40 },
});
