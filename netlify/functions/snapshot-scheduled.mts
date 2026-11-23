import type { Config } from "@netlify/functions";
import { snapshotIfNeeded } from "../lib/store.mts";

// Every 15 minutes: rebuild /api/jobs (each region) and the /jobs/<slug> pages once, so visitors and Googlebot
// get a ready-made response instead of waiting several seconds for loadAll().
export default async () => {
  const r = await snapshotIfNeeded();
  console.log("snapshot", JSON.stringify(r));
};
export const config: Config = { schedule: "*/15 * * * *" };
