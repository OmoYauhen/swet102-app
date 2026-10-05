# swet102-app

Android companion app for [**Swet102**](https://github.com/OmoYauhen/swet102),
the firmware for the Bafang SW102 display on one e-bike (PET). Started as a copy
of [swang-stodva-app](https://github.com/OmoYauhen/swang-stodva-app).

What it's for: the display's **Player** and **Gate** pages. A press on the
handlebar becomes a notification over BLE; this app turns it into:

| Display | Phone |
|---|---|
| Player: LEFT click / RIGHT click | music volume − / + |
| Player: LEFT hold / RIGHT hold | previous / next track (media key to whatever is playing) |
| Player: RIGHT double-click | play / pause |
| Gate: LEFT / RIGHT | a Home Assistant service call for gate A / gate B |

It also shows the display's telemetry (speed, power, battery, PAS, city/sport,
lights, motor errors) and trips (ride, trip, battery trip, odometer with
max/avg/Ah), and can reboot the display into DFU for a firmware update.

> **Status: new, untested on hardware.** Android only.

## How it works

Everything that has to work with the phone locked in a pocket is native Kotlin,
in a local Expo module (`modules/swet-link`). The React Native UI only shows
state and edits settings.

- **`SwetLinkService`**: a foreground service (ongoing notification, type
  `connectedDevice`). It calls `connectGatt(address, autoConnect = true)`, so
  Android connects in the background whenever the display turns on. No scanning
  after the first pairing. On every connect it subscribes to commands, telemetry
  and trips again (the display doesn't bond, so it keeps no subscriptions). It
  starts again after a phone reboot or an app update, if it was on.
- **Commands**: volume through `AudioManager`, tracks and play/pause as media key
  events (like a headset button). Gates go to Home Assistant on a worker
  thread. Repeated notifications (same `seq`) are ignored.
- **Feedback** for gates, since you can't look at the phone while riding: **one
  short buzz** means it worked, **three** mean it failed. The Ride tab lists the
  recent commands and gate results.

Protocol: swet102 `docs/TECH_DESIGN.md` §9.4. GATT base UUID
`8f03xxxx-da4c-453d-a163-41a592a0e9fd`, service `0001`, telemetry `0002`, command
`0003`, control `0004`, trips `0005`. Decoders: `src/protocol` (TypeScript) and
`Protocol.kt` (commands).

## Setup

1. Install the app (below), open **Setup → Find swet102** with the display on.
   That saves its address and starts the link.
2. Allow the app to **ignore battery optimisation** (button in Setup); some
   phones kill background services otherwise.
3. **Gates:** enter your Home Assistant URL and a
   [long-lived access token](https://www.home-assistant.io/docs/authentication/#your-account-profile)
   (profile → Security), then a service and an entity for each gate, e.g.
   `button.press` + `button.gate_a`, or `switch.turn_on` + `switch.garage`, or
   `script.turn_on` + `script.open_gate`. The app sends
   `POST <url>/api/services/<domain>/<service>` with `{"entity_id": "<entity>"}`.
   **Test A / Test B** run the same call.

The URL must be reachable from wherever you ride (Nabu Casa, your own HTTPS
domain, or a VPN). The token is kept in the app's private storage on the phone.

## Build

On NixOS the flake provides the Android SDK/NDK, JDK and Node:

```bash
npm install
nix develop -c npx expo run:android        # build + install on a USB-connected phone
```

```bash
npm test                 # protocol decoders (jest)
npm run type-check
nix develop -c bash -c 'npx expo prebuild -p android && cd android && ./gradlew :swet-link:testDebugUnitTest'
                         # Kotlin unit tests: command parsing, dedup, HA request
```

The UI also opens on web (`npm run web`), but without the native module it only
says that the link needs Android.

## License

[MIT](./LICENSE)
