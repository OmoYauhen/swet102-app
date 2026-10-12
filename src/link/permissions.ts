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

/**
 * Coarse location, for sunrise and sunset (the display's Lights AUTO mode).
 * Optional: without it the app uses the last location it knew, or Warsaw.
 * Returns whether it was granted.
 */
export async function requestLocationPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const P = PermissionsAndroid.PERMISSIONS;
  const result = await PermissionsAndroid.request(P.ACCESS_COARSE_LOCATION);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}
