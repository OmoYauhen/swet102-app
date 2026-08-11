import { useMemo } from "react";
import {
  SafeAreaView,
  StyleSheet,
  Platform,
  StatusBar as RNStatusBar,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { MockTelemetrySource } from "./src/telemetry/mock-source";
import { BleTelemetrySource } from "./src/telemetry/ble-source";
import { DashboardScreen } from "./src/screens/DashboardScreen";

// Use the real BLE source on device; set to false to run the simulated source
// (e.g. on web/simulator, or when the hardware isn't around). BleTelemetrySource
// requires the native ble-plx module, so it's only constructed when enabled.
const USE_BLE = true;

export default function App() {
  // One stable source for the app's lifetime — useMemo constructs it once, not
  // on every render. This is the only place the real and simulated sources are
  // chosen between; everything downstream depends only on TelemetrySource.
  const source = useMemo(
    () => (USE_BLE ? new BleTelemetrySource() : new MockTelemetrySource()),
    [],
  );

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <DashboardScreen source={source} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0f1115",
    // Android draws content under the translucent status bar / camera cutout,
    // and RN's SafeAreaView only insets on iOS — so push everything down by the
    // status bar height (which includes the cutout inset), plus a little room.
    paddingTop:
      Platform.OS === "android" ? (RNStatusBar.currentHeight ?? 0) + 8 : 0,
  },
});
