import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinkState } from "../../modules/swet-link";

export const colors = {
  bg: "#0f1115",
  card: "#1f2937",
  text: "#f3f4f6",
  muted: "#9ca3af",
  accent: "#2563eb",
};

export function StatusBadge({ state }: { state: LinkState }) {
  const color = state === "connected" ? "#22c55e" : state === "off" ? "#6b7280" : "#eab308";
  return (
    <View style={styles.badge}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.badgeText}>{state}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  disabled,
  kind = "primary",
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: "primary" | "plain";
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        kind === "plain" && styles.plain,
        (pressed || disabled) && styles.dim,
      ]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  badgeText: { color: colors.muted, fontSize: 14 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  plain: { backgroundColor: colors.card },
  dim: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "600" },
});
