# swang-stodva-app

A React Native / Expo companion app for the
[**swang-stodva**](https://github.com/OmoYauhen/swang-stodva) SW102 e-bike
display firmware. It connects to the display over Bluetooth Low Energy and shows
live telemetry — speed, battery, power, current, assist level, brake and light
state — on your phone.

> **Status: early.** Tested on Android against a real SW102 driving a Bafang
> BBSHD. iOS is wired up but unverified.

## Features

- Live BLE telemetry from the `swang-stodva` firmware's custom GATT service.
- Clean dashboard: speed, battery %, estimated power, current, assist, brake/lights.
- A built-in **simulated source**, so the UI runs with no hardware (browser or
  simulator).
- Fully local Android builds on NixOS via a `flake.nix` dev shell — no cloud build required.

## How it works

The app is built around a single `TelemetrySource` interface (`src/telemetry/`):

- `BleTelemetrySource` — scans for the `swang-stodva` device by name, connects,
  and subscribes to the telemetry characteristic.
- `MockTelemetrySource` — fabricates plausible telemetry on a timer for
  hardware-free development.

Both feed raw 14-byte packets through the same `parseTelemetry()` decoder, so the
UI is identical whether the data is real or simulated. Toggle between them with
`USE_BLE` in `App.tsx`.

## BLE protocol

The firmware exposes a custom 128-bit telemetry service. It is **not advertised**
(only the 16-bit standard services fit the scan response), so the app scans by
device name and discovers it after connecting.

| | UUID |
|---|---|
| Telemetry service | `57430001-9a43-11e5-a58f-0002a5d5c51b` |
| Telemetry characteristic (read + notify) | `57430002-9a43-11e5-a58f-0002a5d5c51b` |

The characteristic notifies a packed, little-endian 14-byte struct:

| Offset | Field | Type | Scale |
|---|---|---|---|
| 0 | version | u8 | — |
| 1 | speed | i16 | ÷10 → km/h |
| 3 | soc | u8 | % |
| 4 | power | i16 | W |
| 6 | volts | u16 | ÷10 → V |
| 8 | amps | u16 | ÷5 → A |
| 10 | motor temp | i8 | °C |
| 11 | assist level | u8 | — |
| 12 | brake | u8 | 0/1 |
| 13 | lights | u8 | 0/1 |

## Requirements

- Node 22+ and npm.
- For real BLE: a physical **Android** device (BLE doesn't work in Expo Go,
  simulators, or web) and a `swang-stodva` display.
- On NixOS, the included `flake.nix` provides the Android SDK/NDK + JDK toolchain.

## Getting started

Install dependencies:

```bash
npm install
```

### Simulated mode (no hardware)

Set `USE_BLE = false` in `App.tsx`, then:

```bash
npm run web
```

### Real device (Android)

BLE requires a native build, not Expo Go. On NixOS, build and install to a
connected phone (USB debugging enabled) in one command:

```bash
nix develop -c npx expo run:android
```

Then start Metro and reload:

```bash
npx expo start --dev-client
# if the phone can't reach Metro over the network (e.g. NixOS firewall):
adb reverse tcp:8081 tcp:8081
```

Set `USE_BLE = true` in `App.tsx`, power on the display, and reload.

## Development

```bash
npm test         # unit tests (ts-jest)
npm run type-check
```

## Notes

- **Stock Bafang firmware** doesn't report battery voltage or motor temperature,
  so those tiles are hidden and power is estimated from current × a nominal pack
  voltage (`NOMINAL_PACK_VOLTAGE` in `src/screens/DashboardScreen.tsx`). Set it to
  your battery. Running `bbs-fw` on the motor exposes the real values.
- Update latency is bounded by the firmware's BLE connection interval
  (`MIN/MAX_CONN_INTERVAL` in the firmware), not by the app.

## License

[MIT](./LICENSE)
