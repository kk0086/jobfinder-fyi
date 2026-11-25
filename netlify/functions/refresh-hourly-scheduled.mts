import type { Config } from "@netlify/functions";
import { runChunk } from "../lib/store.mts";
import { FEED_CHUNKS as CHUNKS } from "../lib/crawl.mts";

// Hourly pass over the company job boards (Greenhouse, Lever, Ashby and the like): minute N of each hour reads slice N.
// The 13:00 UTC hour is skipped because the daily pass already runs then. To cut cost, thin the schedule below (for example "0-47 */2 * * *" for every second hour).
export default async () => {
  const chunk = Math.min(CHUNKS - 1, new Date().getUTCMinutes());
  const r = await runChunk(chunk);
  console.log("refresh-hourly", JSON.stringify(r));
};

export const config: Config = { schedule: "0-47 0-12,14-23 * * *" };
