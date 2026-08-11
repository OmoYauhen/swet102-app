import { useEffect, useState } from "react";
import { Telemetry } from "./types";
import { ConnectionState, TelemetrySource } from "./source";

/**
 * Subscribe a component to a telemetry source.
 *
 * Returns the latest decoded frame (null until the first one arrives) and the
 * live connection state. Subscribing, connecting, and teardown all happen in one
 * effect; the cleanup unsubscribes and disconnects when the component unmounts
 * or the source changes.
 */
export function useTelemetry(source: TelemetrySource): {
  frame: Telemetry | null;
  connectionState: ConnectionState;
} {
  const [frame, setFrame] = useState<Telemetry | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    source.getState(),
  );

  useEffect(() => {
    const offFrame = source.onTelemetry(setFrame);
    const offState = source.onStateChange(setConnectionState);
    source.connect();
    return () => {
      offFrame();
      offState();
      source.disconnect();
    };
  }, [source]);

  return { frame, connectionState };
}
