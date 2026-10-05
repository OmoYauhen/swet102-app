import { useState } from "react";
import { Platform, Pressable, StatusBar as RNStatusBar, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useLink } from "./src/link/use-link";
import { RideScreen } from "./src/screens/RideScreen";
import { SetupScreen } from "./src/screens/SetupScreen";
import { colors } from "./src/screens/ui";

type Tab = "ride" | "setup";

export default function App() {
  const link = useLink();
  const [tab, setTab] = useState<Tab>("ride");

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.tabs}>
        <Text style={styles.title}>swet102</Text>
        {(["ride", "setup"] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
              {t === "ride" ? "Ride" : "Setup"}
            </Text>
          </Pressable>
        ))}
      </View>
      {!link.available ? (
        <Text style={styles.unavailable}>
          The display link needs the Android build (npx expo run:android); it isn't
          available on web, iOS or in Expo Go.
        </Text>
      ) : tab === "ride" ? (
        <RideScreen link={link} />
      ) : (
        <SetupScreen link={link} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    // RN's SafeAreaView only insets on iOS; Android draws under the status bar.
    paddingTop: Platform.OS === "android" ? (RNStatusBar.currentHeight ?? 0) + 8 : 0,
  },
  tabs: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 20, fontWeight: "800", flex: 1, letterSpacing: 1 },
  tab: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.card },
  tabOn: { backgroundColor: colors.accent },
  tabText: { color: colors.muted, fontWeight: "600" },
  tabTextOn: { color: "#fff" },
  unavailable: { color: colors.muted, padding: 20 },
});
