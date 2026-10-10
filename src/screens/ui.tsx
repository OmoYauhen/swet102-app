import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinkState } from "../../modules/swet-link";

export const colors = {
  bg: "#07090c",
  card: "#141a22",
  line: "#232c38",
  text: "#f3f4f6",
  muted: "#8b95a3",
  dim: "#4b5563",
  accent: "#0ea5e9",
  cyan: "#38bdf8",
  green: "#22c55e",
  amber: "#f59e0b",
  red: "#ef4444",
};

export function StatusBadge({ state }: { state: LinkState }) {
  const color = state === "connected" ? colors.green : state === "off" ? colors.dim : colors.amber;
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
