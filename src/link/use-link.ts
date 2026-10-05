import { useEffect, useState } from "react";
import { LinkState, LogEntry, SwetLink } from "../../modules/swet-link";
import { fromHex, parseTelemetry, parseTrip, Telemetry, Trip, TripId } from "../protocol";

export interface LinkView {
  available: boolean;
  state: LinkState;
  telemetry: Telemetry | null;
  trips: Partial<Record<TripId, Trip>>;
  log: LogEntry[];
}

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null; // one bad packet must not break the screen
  }
}

/**
 * Live view of the native link. The service runs whether or not this screen
 * is open; this only listens, starting from the service's last known values.
 */
export function useLink(): LinkView {
  const [view, setView] = useState<LinkView>(() => {
    if (!SwetLink) {
      return { available: false, state: "off", telemetry: null, trips: {}, log: [] };
    }
    const s = SwetLink.getSnapshot();
    const trips: Partial<Record<TripId, Trip>> = {};
    for (const hex of s.trips) {
      const t = safe(() => parseTrip(fromHex(hex)));
      if (t) trips[t.id] = t;
    }
    return {
      available: true,
      state: s.state,
      telemetry: s.telemetry ? safe(() => parseTelemetry(fromHex(s.telemetry!))) : null,
      trips,
      log: s.log,
    };
  });

  useEffect(() => {
    if (!SwetLink) return;
    const subs = [
      SwetLink.addListener("onState", ({ state }) =>
        setView((v) => ({ ...v, state, telemetry: state === "connected" ? v.telemetry : null })),
      ),
      SwetLink.addListener("onTelemetry", ({ hex }) => {
        const t = safe(() => parseTelemetry(fromHex(hex)));
        if (t) setView((v) => ({ ...v, telemetry: t }));
      }),
      SwetLink.addListener("onTrip", ({ hex }) => {
        const t = safe(() => parseTrip(fromHex(hex)));
        if (t) setView((v) => ({ ...v, trips: { ...v.trips, [t.id]: t } }));
      }),
      SwetLink.addListener("onLog", (e) =>
        setView((v) => ({ ...v, log: [...v.log, e].slice(-30) })),
      ),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  return view;
}
