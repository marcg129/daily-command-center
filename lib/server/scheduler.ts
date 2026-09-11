import "server-only";

import { legacyRequestContext } from "@/lib/runtime/context";
import { localCollectorService } from "@/lib/server/collector-dispatch";

const COLLECTION_INTERVAL_MS = 15 * 60 * 1000;
const STARTUP_DELAY_MS = 5_000;

declare global {
  var controlCenterCollectorTimer: NodeJS.Timeout | undefined;
  var controlCenterCollectorStartupTimer: NodeJS.Timeout | undefined;
  var controlCenterCollectorRunning: boolean | undefined;
}

async function refreshAllCollectors() {
  if (globalThis.controlCenterCollectorRunning) return;
  globalThis.controlCenterCollectorRunning = true;
  try {
    await localCollectorService.dispatchAll(legacyRequestContext());
  } finally {
    globalThis.controlCenterCollectorRunning = false;
  }
}

export function startLocalCollectorScheduler() {
  if (globalThis.controlCenterCollectorTimer || globalThis.controlCenterCollectorStartupTimer) return;
  globalThis.controlCenterCollectorStartupTimer = setTimeout(() => {
    globalThis.controlCenterCollectorStartupTimer = undefined;
    void refreshAllCollectors();
    globalThis.controlCenterCollectorTimer = setInterval(() => void refreshAllCollectors(), COLLECTION_INTERVAL_MS);
    globalThis.controlCenterCollectorTimer.unref();
  }, STARTUP_DELAY_MS);
  globalThis.controlCenterCollectorStartupTimer.unref();
}
