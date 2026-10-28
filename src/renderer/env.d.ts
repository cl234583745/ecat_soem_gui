import type { EcatBridge } from "../shared/types";

declare global {
  interface Window {
    ecatBridge?: EcatBridge;
  }
}

export {};
