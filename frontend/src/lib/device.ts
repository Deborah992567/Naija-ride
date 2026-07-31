// Stable per-install device id used to deduplicate live vehicle reports
// (the same phone reporting twice should look like one vehicle on the map).
import { storage } from "@/src/utils/storage";

const KEY = "device_id";

function randomId(): string {
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function getDeviceId(): Promise<string> {
  const existing = await storage.getItem<string>(KEY, "");
  if (existing) return existing;
  const id = randomId();
  await storage.setItem(KEY, id);
  return id;
}
