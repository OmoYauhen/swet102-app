import { useId, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Polyline,
  RadialGradient,
  Stop,
  SvgXml,
} from "react-native-svg";
import { Telemetry } from "../protocol";
import { PET_SVG, PET_VIEWBOX } from "./pet-svg";
import { colors } from "./ui";

/** Gradient ids are document-wide on web, so each instance suffixes its own. */
function useSvgId() {
  return useId().replace(/[^\w-]/g, "");
}

// ---- speed gauge -----------------------------------------------------------

const G_CX = 150;
const G_CY = 150;
const G_R = 122;
const G_FROM = 145; // degrees, clockwise from +x (y points down)
const G_SWEEP = 250;

function polar(r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: G_CX + r * Math.cos(a), y: G_CY + r * Math.sin(a) };
}

function arc(r: number, from: number, to: number): string {
  const a = polar(r, from);
  const b = polar(r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} A${r},${r} 0 ${large} 1 ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
}

/** The speed, inside an arc that fills up to it, with the assist limit marked. */
export function SpeedGauge({ t }: { t: Telemetry | null }) {
  // the numbers scale with the gauge, which sizes to its slot
  const [k, setK] = useState(1);
  const u = useSvgId();
  const limit = t?.speedLimit ?? 25;
  const max = Math.max(50, Math.ceil((limit + 10) / 10) * 10);
  const speed = t?.speedKmh ?? 0;
  const angle = (v: number) => G_FROM + (G_SWEEP * Math.min(Math.max(v, 0), max)) / max;
  const over = t !== null && speed > limit;
  const fill = over ? colors.amber : colors.cyan;

  const ticks = [];
  for (let v = 0; v <= max; v += 5) {
    const major = v % 10 === 0;
    const a = polar(G_R - 16, angle(v));
    const b = polar(G_R - (major ? 30 : 23), angle(v));
    ticks.push(
      <Line
        key={v}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke={v <= speed && t ? fill : colors.dim}
        strokeWidth={major ? 2.5 : 1.5}
        strokeLinecap="round"
      />,
    );
  }
  const lim = [polar(G_R + 9, angle(limit)), polar(G_R - 9, angle(limit))];

  return (
    <View style={styles.gauge} onLayout={(e) => setK(e.nativeEvent.layout.width / 300)}>
      <Svg width="100%" height="100%" viewBox="0 0 300 268">
        <Defs>
          <LinearGradient id={`gFill${u}`} x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={fill} stopOpacity={0.35} />
            <Stop offset="1" stopColor={fill} stopOpacity={1} />
          </LinearGradient>
          <RadialGradient id={`gHalo${u}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={fill} stopOpacity={0.16} />
            <Stop offset="1" stopColor={fill} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={G_CX} cy={G_CY} r={G_R - 20} fill={`url(#gHalo${u})`} />
        <Path d={arc(G_R, G_FROM, G_FROM + G_SWEEP)} stroke={colors.line} strokeWidth={8} strokeLinecap="round" fill="none" />
        {t && speed > 0 && (
          <Path
            d={arc(G_R, G_FROM, Math.max(angle(speed), G_FROM + 0.5))}
            stroke={`url(#gFill${u})`}
            strokeWidth={8}
            strokeLinecap="round"
            fill="none"
          />
        )}
        {ticks}
        <Line x1={lim[0].x} y1={lim[0].y} x2={lim[1].x} y2={lim[1].y} stroke={colors.amber} strokeWidth={3} strokeLinecap="round" />
      </Svg>
      <View style={styles.gaugeCenter} pointerEvents="none">
        <Text style={[styles.speed, { fontSize: 58 * k, lineHeight: 66 * k }, !t && styles.speedOff]}>
          {t ? t.speedKmh.toFixed(1) : "--"}
        </Text>
        <Text style={[styles.speedUnit, { fontSize: 16 * k }]}>km/h</Text>
      </View>
      <View style={styles.gaugeFoot} pointerEvents="none">
        <Text style={[styles.limit, { fontSize: 14 * k }]}>limit {limit}</Text>
      </View>
    </View>
  );
}

// ---- bike with callouts ----------------------------------------------------

/**
 * The stage, in the drawing's coordinates: the bike, a band above it for the
 * speed gauge and two callouts, and a band below for two more.
 */
const ST = { x: 60, y: -180, w: 1940, h: 2030 };
/** Bottom of the band above the bike. */
const TOP_BAND = 500;
const TILE_W = 0.3;
const TILE_H = 267 / ST.h;
/** Top callouts sit low in their band, beside the gauge's foot. */
const TOP_TILE_Y = TOP_BAND - 330;

/** Points on the drawing the callouts lead to. */
const SPOT = {
  rearHub: { x: 422, y: 1195 },
  display: { x: 1343, y: 672 },
  battery: { x: 898, y: 1248 },
  motor: { x: 1172, y: 1238 },
  lamp: { x: 1480, y: 877 },
};

type Corner = "tl" | "tr" | "bl" | "br";

/** Where a corner tile's leader line starts: its inner edge, nearest the bike. */
function leaderStart(c: Corner) {
  const w = ST.w * TILE_W;
  const h = ST.h * TILE_H;
  const x = c[1] === "l" ? ST.x + w - 50 : ST.x + ST.w - w + 50;
  const y = c[0] === "t" ? TOP_TILE_Y + h : ST.y + ST.h - h;
  return { x, y };
}

function pct(v: number): `${number}%` {
  return `${Math.round(v * 10000) / 100}%`;
}

export function batteryColor(pct: number | null): string {
  if (pct === null) return colors.dim;
  return pct > 50 ? colors.green : pct > 20 ? colors.amber : colors.red;
}

export interface Callout {
  corner: Corner;
  to: keyof typeof SPOT;
  label: string;
  value: string;
  unit?: string;
  color?: string;
  /** 0..1, drawn as a bar under the value. */
  level?: number;
}

/** The PET bike, lit by what the display reports, with readings around it. */
export function BikeStage({ t, callouts }: { t: Telemetry | null; callouts: Callout[] }) {
  const u = useSvgId();
  const battery = batteryColor(t?.batteryPct ?? null);
  const xml = useMemo(() => PET_SVG.replace("BATTERY_FILL", battery), [battery]);
  const power = Math.min((t?.powerW ?? 0) / 750, 1);
  const bike = {
    left: pct((PET_VIEWBOX.x - ST.x) / ST.w),
    top: pct((PET_VIEWBOX.y - ST.y) / ST.h),
    width: pct(PET_VIEWBOX.w / ST.w),
    height: pct(PET_VIEWBOX.h / ST.h),
  };

  return (
    <View style={[styles.stage, { aspectRatio: ST.w / ST.h }]}>
      <View style={[styles.gaugeSlot, { height: pct((TOP_BAND - ST.y) / ST.h) }]}>
        <SpeedGauge t={t} />
      </View>
      <View style={[styles.abs, bike]}>
        <SvgXml xml={xml} width="100%" height="100%" />
      </View>
      <Svg style={StyleSheet.absoluteFill} viewBox={`${ST.x} ${ST.y} ${ST.w} ${ST.h}`}>
        <Defs>
          <RadialGradient id={`motorGlow${u}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.cyan} stopOpacity={0.9} />
            <Stop offset="1" stopColor={colors.cyan} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`batGlow${u}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={battery} stopOpacity={0.45} />
            <Stop offset="1" stopColor={battery} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id={`beam${u}`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#fef9c3" stopOpacity={0.75} />
            <Stop offset="1" stopColor="#fef9c3" stopOpacity={0} />
          </LinearGradient>
        </Defs>

        {t && t.batteryPct !== null && (
          <Circle cx={SPOT.battery.x} cy={SPOT.battery.y} r={230} fill={`url(#batGlow${u})`} />
        )}
        {t?.lights && (
          <G>
            <Polygon
              points={`${SPOT.lamp.x},${SPOT.lamp.y - 20} ${ST.x + ST.w},${SPOT.lamp.y - 150} ${ST.x + ST.w},${SPOT.lamp.y + 260} ${SPOT.lamp.x},${SPOT.lamp.y + 20}`}
              fill={`url(#beam${u})`}
            />
            <Circle cx={SPOT.lamp.x} cy={SPOT.lamp.y} r={18} fill="#fef9c3" />
          </G>
        )}
        {power > 0 && (
          <Circle
            cx={SPOT.motor.x}
            cy={SPOT.motor.y}
            r={90 + 140 * power}
            fill={`url(#motorGlow${u})`}
            opacity={0.25 + 0.6 * power}
          />
        )}

        {callouts.map((c) => {
          const a = leaderStart(c.corner);
          const b = SPOT[c.to];
          const bend = { x: a.x, y: a.y + (c.corner[0] === "t" ? 50 : -50) };
          const col = c.color ?? colors.cyan;
          return (
            <G key={c.corner}>
              <Polyline
                points={`${a.x},${a.y} ${bend.x},${bend.y} ${b.x},${b.y}`}
                stroke={col}
                strokeOpacity={0.55}
                strokeWidth={4}
                fill="none"
              />
              <Circle cx={b.x} cy={b.y} r={22} stroke={col} strokeWidth={4} fill="none" />
              <Circle cx={b.x} cy={b.y} r={9} fill={col} />
            </G>
          );
        })}
      </Svg>

      {callouts.map((c) => (
        <View
          key={c.corner}
          style={[
            styles.tile,
            { width: pct(TILE_W), height: pct(TILE_H) },
            c.corner[0] === "t" ? { top: pct((TOP_TILE_Y - ST.y) / ST.h) } : { bottom: 0 },
            c.corner[1] === "l" ? { left: 0 } : { right: 0 },
          ]}
        >
          <Text style={styles.tileLabel} numberOfLines={1}>
            {c.label}
          </Text>
          <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
            {c.value}
            {c.unit ? <Text style={styles.tileUnit}> {c.unit}</Text> : null}
          </Text>
          {c.level !== undefined && (
            <View style={styles.bar}>
              <View
                style={[
                  styles.barFill,
                  { width: pct(Math.min(Math.max(c.level, 0), 1)), backgroundColor: c.color ?? colors.cyan },
                ]}
              />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

// ---- telltales -------------------------------------------------------------

/** A dashboard warning light: dim when off, lit in its colour when on. */
export function Telltale({ label, on, color }: { label: string; on: boolean; color: string }) {
  return (
    <View style={[styles.telltale, on && { borderColor: color, backgroundColor: `${color}22` }]}>
      <View style={[styles.lamp, { backgroundColor: on ? color : colors.line }]} />
      <Text style={[styles.telltaleText, on && { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gauge: { height: "100%", aspectRatio: 300 / 268 },
  gaugeSlot: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center" },
  gaugeCenter: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", paddingBottom: "12%" },
  speed: {
    color: colors.text,
    fontWeight: "200",
    letterSpacing: -2,
    fontVariant: ["tabular-nums"],
  },
  speedOff: { color: colors.dim },
  speedUnit: { color: colors.muted, letterSpacing: 2 },
  gaugeFoot: { position: "absolute", left: 0, right: 0, bottom: "4%", alignItems: "center" },
  limit: { color: colors.amber, fontWeight: "600", letterSpacing: 1 },

  stage: { width: "100%" },
  abs: { position: "absolute" },
  tile: {
    position: "absolute",
    backgroundColor: "#0e1218cc",
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  tileLabel: { color: colors.muted, fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },
  tileValue: { color: colors.text, fontSize: 22, fontWeight: "300", fontVariant: ["tabular-nums"] },
  tileUnit: { color: colors.muted, fontSize: 12, fontWeight: "400" },
  bar: { height: 3, borderRadius: 2, backgroundColor: colors.line, marginTop: 3, overflow: "hidden" },
  barFill: { height: 3, borderRadius: 2 },

  telltale: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  lamp: { width: 7, height: 7, borderRadius: 4 },
  telltaleText: { color: colors.dim, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
});
