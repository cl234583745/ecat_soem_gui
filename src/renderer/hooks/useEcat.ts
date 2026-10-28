import { useEffect, useState } from "react";
import { ecatBridge } from "../lib/bridge";
import type { Snapshot } from "../../shared/types";

export function useEcat() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    let active = true;
    void ecatBridge.getSnapshot().then((initial) => {
      if (active) {
        setSnapshot(initial);
      }
    });
    const unsubscribe = ecatBridge.subscribe((next) => {
      if (active) {
        setSnapshot(next);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { snapshot, bridge: ecatBridge };
}
