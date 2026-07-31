// Favorites / route follows — mirrors backend RouteFollow rows in AsyncStorage
// so the follow state works offline and syncs when the server is reachable.
import { storage } from "@/src/utils/storage";
import { api, type Follow } from "./api";

const FOLLOWS_KEY = "favorite_routes";

export async function getLocalFollows(): Promise<Set<string>> {
  const raw = await storage.getItem<string>(FOLLOWS_KEY, "[]");
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

async function saveLocalFollows(ids: Set<string>) {
  await storage.setItem(FOLLOWS_KEY, JSON.stringify([...ids]));
}

export async function loadFollowsFromServer(): Promise<Set<string>> {
  try {
    const follows = await api.listFollows();
    const ids = new Set(follows.map((f) => f.route_id));
    await saveLocalFollows(ids);
    return ids;
  } catch {
    return getLocalFollows();
  }
}

export async function toggleFollow(routeId: string): Promise<boolean> {
  const ids = await getLocalFollows();
  const following = !ids.has(routeId);
  if (following) {
    ids.add(routeId);
  } else {
    ids.delete(routeId);
  }
  await saveLocalFollows(ids);
  // Best-effort server sync.
  try {
    if (following) {
      await api.followRoute(routeId);
    } else {
      await api.unfollowRoute(routeId);
    }
  } catch {
    // Keep local state; will sync on next app open via loadFollowsFromServer.
  }
  return following;
}

export async function isFollowing(routeId: string): Promise<boolean> {
  return (await getLocalFollows()).has(routeId);
}

export type { Follow };
