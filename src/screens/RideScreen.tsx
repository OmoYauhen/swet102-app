import { ScrollView, StyleSheet, Text, View } from "react-native";
import { LinkView } from "../link/use-link";
import { Trip, TripId } from "../protocol";
import { colors, StatusBadge } from "./ui";

const TRIP_LABELS: [TripId, string][] = [
  ["ride", "Ride"],
  ["trip", "Trip"],
  ["battery", "Battery trip"],
];

/** What the display shows, plus the trips and what the phone did for it. */
export function RideScreen({ link }: { link: LinkView }) {
  const t = link.telemetry;
  const odo = link.trips.odometer;
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <StatusBadge state={link.state} />

      {t ? (
        <>
          {t.error && (
            <View style={styles.error}>
              <Text style={styles.errorText}>
                {t.error === "link" ? "Motor link lost" : `Motor error ${t.error}`}
              </Text>
            </View>
          )}
          <View style={styles.speedBlock}>
            <Text style={styles.speed}>{t.speedKmh.toFixed(1)}</Text>
            <Text style={styles.unit}>km/h</Text>
          </View>
          <View style={styles.grid}>
            <Stat label="Battery" value={t.batteryPct === null ? "--" : `${t.batteryPct}%`} />
            <Stat label="Power" value={`${t.powerW} W`} />
            <Stat label="Assist" value={t.walk ? "walk" : `${t.pas}`} />
            <Stat label={t.sport ? "Sport" : "City"} value={`${t.speedLimit} km/h`} />
          </View>
          <View style={styles.flags}>
            <Flag label="Lights" on={t.lights} />
            <Flag label="Motor" on={t.motorLink} />
          </View>
        </>
      ) : (
        <Text style={styles.muted}>
          {link.state === "connected" ? "Waiting for telemetry…" : "Not connected to the display"}
        </Text>
      )}

      <View style={styles.trips}>
        {TRIP_LABELS.map(([id, label]) => (
          <TripRow key={id} label={label} trip={link.trips[id]} />
        ))}
        {odo && (
          <Text style={styles.muted}>
            Odometer {odo.km.toFixed(1)} km · max {odo.maxKmh.toFixed(1)} km/h
          </Text>
        )}
      </View>

      <View style={styles.log}>
        <Text style={styles.heading}>From the display</Text>
        {link.log.length === 0 && <Text style={styles.muted}>Nothing yet</Text>}
        {[...link.log].reverse().map((e, i) => (
          <Text key={`${e.at}-${i}`} style={[styles.logLine, !e.ok && styles.logFail]}>
            {new Date(e.at).toLocaleTimeString()}  {e.text}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

function TripRow({ label, trip }: { label: string; trip?: Trip }) {
  return (
    <View style={styles.trip}>
      <Text style={styles.tripLabel}>{label}</Text>
      {trip ? (
        <Text style={styles.tripValue}>
          {trip.km.toFixed(1)} km · max {trip.maxKmh.toFixed(1)} · avg {trip.avgKmh.toFixed(1)} ·{" "}
          {trip.ah.toFixed(2)} Ah
        </Text>
      ) : (
        <Text style={styles.muted}>--</Text>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Flag({ label, on }: { label: string; on: boolean }) {
  return (
    <View style={[styles.flag, on && styles.flagOn]}>
      <Text style={[styles.flagText, on && styles.flagTextOn]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 18, alignItems: "center" },
  error: { backgroundColor: "#7f1d1d", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 16 },
  errorText: { color: "#fecaca", fontWeight: "700", fontSize: 16 },
  speedBlock: { alignItems: "center" },
  speed: { color: colors.text, fontSize: 96, fontWeight: "800", lineHeight: 100 },
  unit: { color: colors.muted, fontSize: 18, marginTop: -4 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12 },
  stat: {
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minWidth: 96,
    alignItems: "center",
  },
  statValue: { color: colors.text, fontSize: 22, fontWeight: "700" },
  statLabel: { color: colors.muted, fontSize: 13, marginTop: 4 },
  flags: { flexDirection: "row", gap: 12 },
  flag: { backgroundColor: colors.card, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 20 },
  flagOn: { backgroundColor: "#065f46" },
  flagText: { color: "#6b7280", fontWeight: "600" },
  flagTextOn: { color: "#a7f3d0" },
  trips: { alignSelf: "stretch", gap: 10 },
  trip: { backgroundColor: colors.card, borderRadius: 12, padding: 12 },
  tripLabel: { color: colors.muted, fontSize: 13 },
  tripValue: { color: colors.text, fontSize: 15, marginTop: 2 },
  log: { alignSelf: "stretch", gap: 4 },
  heading: { color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: 4 },
  logLine: { color: colors.text, fontVariant: ["tabular-nums"] },
  logFail: { color: "#fca5a5" },
  muted: { color: colors.muted },
});
