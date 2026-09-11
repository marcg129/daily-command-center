import { systemClock, webIdGenerator } from "@/lib/runtime/primitives";
import { getDatabase } from "@/lib/server/database";
import { createReminderHandler } from "@/lib/server/reminder-service";

export const runtime = "nodejs";
export const PUT = createReminderHandler(getDatabase, systemClock, webIdGenerator);
