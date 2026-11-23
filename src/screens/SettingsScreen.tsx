import { ScrollView, StyleSheet } from "react-native";
import { LinkView } from "../link/use-link";
import { OtaSections } from "./OtaSections";
import { SetupSections } from "./SetupSections";

/** Behind the cog: the link and Home Assistant setup, then the firmware update. */
export function SettingsScreen({ link }: { link: LinkView }) {
  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <SetupSections link={link} />
      {/* demo telemetry has no display behind it to update */}
      {!link.demo && <OtaSections link={link} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 20 },
});
