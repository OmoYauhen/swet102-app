import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { FirmwareInfo, LinkSettings, SwetLink } from "../../modules/swet-link";
import { LinkView } from "../link/use-link";
import { requestLinkPermissions } from "../link/permissions";
import {
  DONE_TEXT,
  formatBuild,
  formatSize,
  nextScanDelay,
  parseBuild,
  Run,
  runFromEvent,
  SCAN_WINDOW_MS,
  SEEN_TTL_MS,
  verdict,
} from "../ota";
import { Button, colors } from "./ui";

interface Chosen {
  uri: string;
  name: string;
  info: FirmwareInfo;
}

interface Seen {
  address: string;
  rssi: number;
  at: number;
}

/**
 * Firmware update over BLE (Nordic Secure DFU) to the display's bootloader,
 * which the rider starts by hand (M + PWR) and which advertises as SW102_DFU.
 */
export function OtaScreen({ link }: { link: LinkView }) {
  const native = SwetLink!;
  const [settings, setSettings] = useState<LinkSettings>(() => native.getSettings());
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [seen, setSeen] = useState<Seen | null>(null);
  const [scanning, setScanning] = useState(false);
  const [run, setRun] = useState<Run>(() => {
    const d = native.getDfu();
    return d.last ? runFromEvent(d.last) : { phase: "idle" };
  });
  const running = run.phase === "running";
  // Look for the bootloader before an update, or to try again after one failed.
  const looking = chosen !== null && run.phase !== "running" && run.phase !== "done";

  // The build is read on every connect, and set by a finished update.
  useEffect(() => setSettings(native.getSettings()), [link.state, run.phase]);

  useEffect(() => {
    const sub = native.addListener("onDfu", (e) => setRun(runFromEvent(e)));
    return () => sub.remove();
  }, []);

  // Keep looking for the bootloader while a zip is chosen and nothing runs.
  useEffect(() => {
    if (!looking) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scan = async () => {
      const started = Date.now();
      setScanning(true);
      let found: { address: string; rssi: number } | null = null;
      try {
        found = await native.scanDfu(SCAN_WINDOW_MS);
      } catch {
        found = null; // Bluetooth off or no permission: shows as not found
      }
      if (cancelled) return;
      setScanning(false);
      const now = Date.now();
      setSeen((prev) => (found ? { ...found, at: now } : prev && now - prev.at < SEEN_TTL_MS ? prev : null));
      timer = setTimeout(scan, nextScanDelay(started, now));
    };
    scan();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      setScanning(false);
    };
  }, [looking]);

  async function choose() {
    setPickError(null);
    const refused = await requestLinkPermissions();
    if (refused.length > 0) {
      Alert.alert("Permissions needed", `Refused: ${refused.map((p) => p.split(".").pop()).join(", ")}`);
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    try {
      const info = await native.inspectFirmware(asset.uri);
      setChosen({ uri: asset.uri, name: asset.name || info.name, info });
      setRun({ phase: "idle" });
    } catch (e) {
      setChosen(null);
      setPickError(e instanceof Error ? e.message : String(e));
    }
  }

  function update() {
    if (!chosen || !seen) return;
    Alert.alert(
      "Update the display?",
      `Build ${formatBuild(chosen.info.fwVersion)}. Keep the phone next to the display until it's done.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Update",
          onPress: () => {
            try {
              native.startDfu(seen.address, chosen.uri);
            } catch (e) {
              const error = e instanceof Error ? e.message : String(e);
              setRun({ phase: "failed", error, hint: null });
            }
          },
        },
      ],
    );
  }

  const installed = parseBuild(settings.displayBuild);
  const v = chosen ? verdict(chosen.info.fwVersion, settings.displayBuild) : null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Section title="Display">
        <Text style={styles.text}>
          {installed !== null
            ? `Installed build ${formatBuild(installed)}`
            : settings.displayBuild === "-"
              ? "Installed: a development build (no build number)"
              : "Installed build: unknown"}
          {settings.displayVersion ? `  (v${settings.displayVersion})` : ""}
        </Text>
        <Text style={styles.hint}>
          As read from the display the last time the app was connected to it.
        </Text>
      </Section>

      <Section title="Firmware">
        <Button title="Choose firmware (.zip)" onPress={choose} disabled={running} />
        {pickError && <Text style={styles.error}>{pickError}</Text>}
        {chosen && (
          <>
            <Text style={styles.text}>{chosen.name}</Text>
            <Text style={styles.muted}>
              {formatSize(chosen.info.size)} · build {formatBuild(chosen.info.fwVersion)}
            </Text>
          </>
        )}
        {!chosen && !pickError && (
          <Text style={styles.hint}>
            A release zip from swet102 (make release → build/swet102-YYMMDDHH.zip).
          </Text>
        )}
      </Section>

      {chosen && (
        <Section title="Update">
          {!running && run.phase !== "done" && (
            <>
              <Text style={styles.text}>
                Display off, then hold M + PWR for 8 s until it shows up as SW102_DFU.
              </Text>
              <View style={styles.row}>
                <View
                  style={[styles.dot, { backgroundColor: seen ? colors.green : scanning ? colors.amber : colors.dim }]}
                />
                <Text style={styles.muted}>
                  {seen
                    ? `SW102_DFU found · ${seen.rssi} dBm`
                    : scanning
                      ? "Looking for SW102_DFU…"
                      : "SW102_DFU not found"}
                </Text>
              </View>
              {v && <Text style={v.canUpdate ? styles.text : styles.warn}>{v.text}</Text>}
              {v?.canUpdate && <Button title="Update" onPress={update} disabled={!seen} />}
            </>
          )}

          {run.phase === "running" && (
            <>
              <Text style={styles.text}>{run.label}</Text>
              <View style={styles.bar}>
                <View style={[styles.fill, { width: `${run.percent ?? 0}%` }]} />
              </View>
              {run.percent !== null && <Text style={styles.muted}>{run.percent}%</Text>}
              <Button kind="plain" title="Cancel" onPress={() => native.abortDfu()} />
            </>
          )}
          {run.phase === "done" && <Text style={styles.ok}>{DONE_TEXT}</Text>}
          {run.phase === "aborted" && (
            <Text style={styles.warn}>
              Cancelled. The display stays in its bootloader; start again while it shows up as
              SW102_DFU.
            </Text>
          )}
          {run.phase === "failed" && (
            <>
              <Text style={styles.error}>Update failed: {run.error}</Text>
              {run.hint && <Text style={styles.hint}>{run.hint}</Text>}
            </>
          )}
        </Section>
      )}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 20 },
  section: {
    backgroundColor: "#0e1218",
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  heading: { color: colors.text, fontSize: 18, fontWeight: "700" },
  text: { color: colors.text },
  muted: { color: colors.muted },
  hint: { color: colors.muted, fontSize: 13 },
  ok: { color: colors.green },
  warn: { color: colors.amber },
  error: { color: colors.red },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.card, overflow: "hidden" },
  fill: { height: 8, backgroundColor: colors.accent },
});
