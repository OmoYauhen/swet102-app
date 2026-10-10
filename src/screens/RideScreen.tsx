import { ScrollView, StyleSheet, Text, View } from "react-native";
import { LinkView } from "../link/use-link";
import { Trip, TripId } from "../protocol";
import { batteryColor, BikeStage, Callout, Telltale } from "./dash";
import { colors, StatusBadge } from "./ui";

const TRIP_LABELS: [TripId, string][] = [
  ["ride", "Ride"],
  ["trip", "Trip"],
  ["battery", "Battery trip"],
];

/** What the display shows, as a dashboard around the bike, plus trips and the phone's log. */
export function RideScreen({ link }: { link: LinkView }) {
  const t = link.telemetry;
  const odo = link.trips.odometer;
  const odoKm = t?.odoKm ?? odo?.km;

  const callouts: Callout[] = [
    {
      corner: "tl",
      to: "rearHub",
      label: "ODOMETER",
      value: odoKm === undefined ? "--" : odoKm.toFixed(1),
      unit: "km",
    },
    {
      corner: "tr",
      to: "display",
      label: "ASSIST",
      value: !t ? "--" : t.walk ? "WALK" : `${t.pas}`,
      unit: t && !t.walk ? "PAS" : undefined,
      level: t && !t.walk ? t.pas / 5 : undefined,
    },
    {
      corner: "bl",
      to: "battery",
      label: "BATTERY",
      value: t?.batteryPct == null ? "--" : `${t.batteryPct}`,
      unit: "%",
      color: batteryColor(t?.batteryPct ?? null),
      level: t?.batteryPct == null ? undefined : t.batteryPct / 100,
    },
    {
      corner: "br",
      to: "motor",
      label: "POWER",
      value: t ? `${t.powerW}` : "--",
      unit: "W",
      level: t ? t.powerW / 750 : undefined,
    },
  ];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.telltales}>
        <StatusBadge state={link.state} />
        <View style={styles.lamps}>
          <Telltale label={t?.sport ? "SPORT" : "CITY"} on={!!t} color={t?.sport ? colors.amber : colors.cyan} />
          <Telltale label="LIGHTS" on={!!t?.lights} color={colors.green} />
          <Telltale label="MOTOR" on={!!t?.motorLink} color={colors.cyan} />
        </View>
      </View>

      {t?.error && (
        <View style={styles.error}>
          <Text style={styles.errorText}>
            {t.error === "link" ? "Motor link lost" : `Motor error ${t.error}`}
          </Text>
        </View>
      )}

      <BikeStage t={t} callouts={callouts} />

      {!t && (
        <Text style={styles.muted}>
          {link.state === "connected" ? "Waiting for telemetry…" : "Not connected to the display"}
        </Text>
      )}

      <View style={styles.trips}>
        {TRIP_LABELS.map(([id, label]) => (
          <TripCard key={id} label={label} trip={link.trips[id]} />
        ))}
      </View>
      {odo && (
        <Text style={styles.muted}>
          Odometer {odo.km.toFixed(1)} km · max {odo.maxKmh.toFixed(1)} km/h
        </Text>
      )}

      <View style={styles.log}>
        <Text style={styles.heading}>FROM THE DISPLAY</Text>
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

function TripCard({ label, trip }: { label: string; trip?: Trip }) {
  return (
    <View style={styles.trip}>
      <Text style={styles.tripLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.tripKm}>
        {trip ? trip.km.toFixed(1) : "--"}
        <Text style={styles.tripUnit}> km</Text>
      </Text>
      {trip && (
        <>
          <Text style={styles.tripLine}>avg {trip.avgKmh.toFixed(1)} · max {trip.maxKmh.toFixed(1)}</Text>
          <Text style={styles.tripLine}>{trip.ah.toFixed(2)} Ah</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 14, alignItems: "center" },
  telltales: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  lamps: { flexDirection: "row", gap: 8 },
  error: { backgroundColor: "#7f1d1d", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 16 },
  errorText: { color: "#fecaca", fontWeight: "700", fontSize: 16 },
  trips: { alignSelf: "stretch", flexDirection: "row", gap: 8 },
  trip: {
    flex: 1,
    backgroundColor: "#0e1218",
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 2,
  },
  tripLabel: { color: colors.muted, fontSize: 10, fontWeight: "700", letterSpacing: 1.2 },
  tripKm: { color: colors.text, fontSize: 20, fontWeight: "300", fontVariant: ["tabular-nums"] },
  tripUnit: { color: colors.muted, fontSize: 12 },
  tripLine: { color: colors.muted, fontSize: 11, fontVariant: ["tabular-nums"] },
  log: { alignSelf: "stretch", gap: 4 },
  heading: { color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1.5, marginBottom: 4 },
  logLine: { color: colors.text, fontVariant: ["tabular-nums"] },
  logFail: { color: "#fca5a5" },
  muted: { color: colors.muted },
});
