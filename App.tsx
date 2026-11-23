import { useEffect, useState } from "react";
import { BackHandler, Platform, Pressable, StatusBar as RNStatusBar, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import Svg, { Path } from "react-native-svg";
import { SwetLink } from "./modules/swet-link";
import { useLink } from "./src/link/use-link";
import { RideScreen } from "./src/screens/RideScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { colors } from "./src/screens/ui";

// Material "settings" icon, 24×24
const COG =
  "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z";

export default function App() {
  const link = useLink();
  // The ride dashboard is home; the cog opens settings (setup and firmware update).
  const [settings, setSettings] = useState(false);

  // Android back leaves settings for the dashboard instead of closing the app.
  useEffect(() => {
    if (!settings) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setSettings(false);
      return true;
    });
    return () => sub.remove();
  }, [settings]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>
          swet102{link.demo && <Text style={styles.demo}>  DEMO</Text>}
        </Text>
        <Pressable
          onPress={() => setSettings(!settings)}
          style={[styles.cog, settings && styles.cogOn]}
          accessibilityRole="button"
          accessibilityLabel={settings ? "Back to the dashboard" : "Settings"}
          hitSlop={8}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path d={COG} fill={settings ? "#fff" : colors.muted} />
          </Svg>
        </Pressable>
      </View>
      {!link.available || (settings && !SwetLink) ? (
        <Text style={styles.unavailable}>
          The display link needs the Android build (npx expo run:android); it isn't
          available on web, iOS or in Expo Go.
        </Text>
      ) : settings ? (
        <SettingsScreen link={link} />
      ) : (
        <RideScreen link={link} />
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
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 20, fontWeight: "800", flex: 1, letterSpacing: 1 },
  demo: { color: colors.amber, fontSize: 12, fontWeight: "700", letterSpacing: 2 },
  cog: { padding: 7, borderRadius: 999, backgroundColor: colors.card },
  cogOn: { backgroundColor: colors.accent },
  unavailable: { color: colors.muted, padding: 20 },
});
