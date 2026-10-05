import { PermissionsAndroid, Platform } from "react-native";

/**
 * Everything the link service needs at runtime: Bluetooth (scan once, connect
 * always) and, on Android 13+, posting its ongoing notification.
 * Returns the permissions that were refused.
 */
export async function requestLinkPermissions(): Promise<string[]> {
  if (Platform.OS !== "android") return [];
  const api = Platform.Version as number;
  const P = PermissionsAndroid.PERMISSIONS;
  const needed =
    api >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION];
  if (api >= 33) needed.push(P.POST_NOTIFICATIONS);
  const result = await PermissionsAndroid.requestMultiple(needed);
  return needed.filter((p) => result[p] !== PermissionsAndroid.RESULTS.GRANTED);
}
