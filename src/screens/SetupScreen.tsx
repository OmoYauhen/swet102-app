import { useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { LinkSettings, SwetLink } from "../../modules/swet-link";
import { LinkView } from "../link/use-link";
import { requestLinkPermissions } from "../link/permissions";
import { Button, colors, StatusBadge } from "./ui";

/**
 * First-run pairing, the link switch, Home Assistant for the gates, and the
 * display's DFU reboot.
 */
export function SetupScreen({ link }: { link: LinkView }) {
  const native = SwetLink!;
  const [s, setS] = useState<LinkSettings>(() => native.getSettings());
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () => setS(native.getSettings());

  async function permitted(): Promise<boolean> {
    const refused = await requestLinkPermissions();
    if (refused.length > 0) {
      Alert.alert("Permissions needed", `Refused: ${refused.map((p) => p.split(".").pop()).join(", ")}`);
      return false;
    }
    return true;
  }

  async function pair() {
    if (!(await permitted())) return;
    setBusy("Looking for swet102…");
    const address = await native.pair(20_000);
    setBusy(null);
    if (!address) {
      Alert.alert("Not found", "Is the display on and nearby? It advertises as swet102.");
      return;
    }
    native.start();
    reload();
  }

  async function toggle(on: boolean) {
    if (on) {
      if (!(await permitted())) return;
      native.start();
    } else {
      native.stop();
    }
    reload();
  }

  function forget() {
    Alert.alert("Forget the display?", "The link stops until you pair again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Forget",
        style: "destructive",
        onPress: () => {
          native.forget();
          reload();
        },
      },
    ]);
  }

  function saveHa() {
    native.saveHomeAssistant(s.haUrl, s.haToken, s.gateAService, s.gateAEntity, s.gateBService, s.gateBEntity);
    reload();
  }

  async function testGate(which: "A" | "B") {
    saveHa();
    setBusy(`Opening gate ${which}…`);
    const error = await native.testGate(which);
    setBusy(null);
    Alert.alert(`Gate ${which}`, error ?? "Done");
  }

  function dfu() {
    Alert.alert(
      "Reboot the display to DFU?",
      "Assist stops until it's back. The wheel must have been still for 5 s.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reboot",
          onPress: () => {
            if (!native.rebootToDfu()) Alert.alert("Not connected to the display");
          },
        },
      ],
    );
  }

  const field = (key: keyof LinkSettings, placeholder: string, secure = false) => (
    <TextInput
      style={styles.input}
      value={String(s[key] ?? "")}
      placeholder={placeholder}
      placeholderTextColor="#4b5563"
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={secure}
      onChangeText={(v) => setS({ ...s, [key]: v })}
    />
  );

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Section title="Display">
        <StatusBadge state={link.state} />
        {s.address ? (
          <>
            <Text style={styles.text}>Paired with {s.address}</Text>
            <View style={styles.row}>
              <Text style={styles.text}>Keep connected in the background</Text>
              <Switch value={s.enabled} onValueChange={toggle} />
            </View>
            <View style={styles.buttons}>
              <Button kind="plain" title="Forget" onPress={forget} />
              <Button kind="plain" title="Reboot display to DFU" onPress={dfu} />
            </View>
          </>
        ) : (
          <Button title="Find swet102" onPress={pair} disabled={busy !== null} />
        )}
        <Text style={styles.hint}>
          For a reliable link with the phone in your pocket, let the app ignore battery
          optimisation.
        </Text>
        <Button
          kind="plain"
          title="Battery optimisation settings"
          onPress={() => Linking.sendIntent("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS")}
        />
      </Section>

      <Section title="Gates (Home Assistant)">
        {field("haUrl", "https://homeassistant.local:8123")}
        {field("haToken", "Long-lived access token", true)}
        <Text style={styles.label}>Gate A (LEFT on the Gate page)</Text>
        {field("gateAService", "button.press")}
        {field("gateAEntity", "button.gate_a")}
        <Text style={styles.label}>Gate B (RIGHT)</Text>
        {field("gateBService", "button.press")}
        {field("gateBEntity", "button.gate_b")}
        <View style={styles.buttons}>
          <Button title="Save" onPress={saveHa} />
          <Button kind="plain" title="Test A" onPress={() => testGate("A")} disabled={!s.enabled} />
          <Button kind="plain" title="Test B" onPress={() => testGate("B")} disabled={!s.enabled} />
        </View>
        <Text style={styles.hint}>
          Each gate calls a Home Assistant service on an entity, e.g. button.press /
          switch.turn_on / cover.open_cover / script.turn_on. The phone buzzes once when
          it worked, three times when it didn't.
        </Text>
      </Section>

      {busy && <Text style={styles.text}>{busy}</Text>}
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
  label: { color: colors.muted, marginTop: 6 },
  hint: { color: colors.muted, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
