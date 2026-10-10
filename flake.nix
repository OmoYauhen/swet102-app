{
  description = "swet102-app — Android companion app for the Swet102 SW102 display";

  # Usage:
  #   nix develop                      dev shell: Android SDK/NDK + JDK 17 + Node
  #   nix develop -c npx expo run:android
  #                                    prebuild + build + install to a connected
  #                                    phone (USB debugging) in one shot, then
  #                                    starts Metro. This is the "one command".
  #   nix develop .#emulator -c swet-emu
  #                                    boots an Android 35 emulator (AVD "swet102",
  #                                    created on first run). Then, from the
  #                                    default shell:
  #                                      EXPO_PUBLIC_DEMO=1 npx expo run:android
  #                                    The emulator has no BLE path to the real
  #                                    display, so demo mode feeds fake telemetry.
  #
  # This is a dev SHELL, not a hermetic `nix build`: it pins the toolchain, but
  # Gradle/npm still fetch their own deps over the network at build time. A fully
  # hermetic APK build (vendoring npm + Gradle offline) is a much bigger job and
  # deliberately out of scope. The point here is a reproducible toolchain that
  # actually runs on NixOS — androidenv ships SDK binaries patched for the Nix
  # store, which is what makes aapt2 & friends work without an FHS hack.

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        # Android SDK is unfree and needs its license accepted — both are set on
        # THIS pkgs import so we don't touch the user's global nixpkgs config.
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
            android_sdk.accept_license = true;
          };
        };

        # The version strings below are the thing most likely to need a tweak:
        # they must exist in nixpkgs androidenv AND satisfy what `expo prebuild`
        # generates for Expo SDK 57 / RN 0.86. If eval complains a version isn't
        # available, that's the knob to turn.
        buildToolsVersion = "35.0.0";
        ndkVersion = "27.1.12297006";

        androidComposition = pkgs.androidenv.composeAndroidPackages {
          platformVersions = [ "34" "35" "36" ];
          buildToolsVersions = [ buildToolsVersion "36.0.0" ];
          includeNDK = true;
          ndkVersions = [ ndkVersion ];
          cmakeVersions = [ "3.22.1" ];
          includeEmulator = false;
          includeSystemImages = false;
        };

        androidSdk = androidComposition.androidsdk;
        sdkRoot = "${androidSdk}/libexec/android-sdk";

        # A separate SDK just to run an emulator: the emulator and one system
        # image are a few GB, so the default (and CI) shell doesn't pull them.
        # androidenv fetches an image per platform version, hence only "35".
        emuSdk = (pkgs.androidenv.composeAndroidPackages {
          platformVersions = [ "35" ];
          includeEmulator = true;
          includeSystemImages = true;
          systemImageTypes = [ "google_apis" ];
          abiVersions = [ "x86_64" ];
        }).androidsdk;
        emuRoot = "${emuSdk}/libexec/android-sdk";

        # Creates the AVD on first run, then boots it. Extra args go to the
        # emulator, e.g. `swet-emu -gpu swiftshader_indirect` if host GL fails.
        # avdmanager (XDG_CONFIG_HOME) and the emulator (~/.android) look in
        # different places, so pin both. Device profiles don't load from the
        # Nix store (no devices.xml), so the screen is set in config.ini.
        swetEmu = pkgs.writeShellScriptBin "swet-emu" ''
          set -eu
          export ANDROID_HOME=${emuRoot} ANDROID_SDK_ROOT=${emuRoot}
          export ANDROID_AVD_HOME="${"$"}{ANDROID_AVD_HOME:-$HOME/.android/avd}"
          # The emulator's Qt has no Wayland plugin; go through Xwayland. And
          # NixOS keeps the GL drivers where a store binary doesn't look.
          export QT_QPA_PLATFORM=xcb
          export LD_LIBRARY_PATH="/run/opengl-driver/lib${"$"}{LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
          if [ ! -f "$ANDROID_AVD_HOME/swet102.ini" ]; then
            echo no | ${emuSdk}/bin/avdmanager create avd \
              -n swet102 -k "system-images;android-35;google_apis;x86_64"
            cat >> "$ANDROID_AVD_HOME/swet102.avd/config.ini" <<CONF
          hw.lcd.width=1080
          hw.lcd.height=2400
          hw.lcd.density=420
          hw.ramSize=4096
          hw.keyboard=yes
          CONF
          fi
          exec ${emuRoot}/emulator/emulator -avd swet102 -gpu host "$@"
        '';
      in {
        devShells.emulator = pkgs.mkShell {
          buildInputs = [ swetEmu ];
          ANDROID_HOME = emuRoot;
          ANDROID_SDK_ROOT = emuRoot;
          shellHook = ''
            export PATH="${emuRoot}/platform-tools:${emuRoot}/emulator:$PATH"
          '';
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.jdk17
            pkgs.nodejs_22
            androidSdk
            pkgs.watchman # RN file watcher; large projects choke without it
          ];

          # RN's Gradle reads these to find the SDK/NDK.
          ANDROID_HOME = sdkRoot;
          ANDROID_SDK_ROOT = sdkRoot;
          ANDROID_NDK_ROOT = "${sdkRoot}/ndk/${ndkVersion}";
          JAVA_HOME = "${pkgs.jdk17}";

          shellHook = ''
            # Gradle downloads its OWN aapt2 from Maven — a generic-Linux binary
            # that won't run on NixOS. Force it to use the patched one from the
            # Nix store instead. This single override is the classic fix.
            export GRADLE_OPTS="-Dorg.gradle.project.android.aapt2FromMavenOverride=${sdkRoot}/build-tools/${buildToolsVersion}/aapt2 $GRADLE_OPTS"

            # adb, fastboot, etc.
            export PATH="${sdkRoot}/platform-tools:$PATH"

            echo "swet102-app dev shell"
            echo "  ANDROID_HOME=$ANDROID_HOME"
            echo "  build a debug APK:  npx expo run:android   (phone via USB, USB debugging on)"
          '';
        };
      });
}
