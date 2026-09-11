import "server-only";

import type { OutboundTransport } from "@/lib/runtime/outbound-transport";
import { safeFetchText } from "@/lib/server/safe-fetch";

// This adapter intentionally retains safeFetchText's DNS validation and socket pinning.
export const localOutboundTransport: OutboundTransport = {
  readText: (url, options) => safeFetchText(url, options),
};
