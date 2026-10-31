import type { Config } from "@netlify/functions";
import { runChunk } from "../lib/store.mts";
import { FEED_CHUNKS as CHUNKS } from "../lib/crawl.mts";

// Fires every minute from 13:00 to 13:47 UTC (48 runs); each run reads one slice of the company job boards.
export default async () => {
  const chunk = Math.min(CHUNKS - 1, new Date().getUTCMinutes());
  const r = await runChunk(chunk);
  console.log("refresh", JSON.stringify(r));
};

export const config: Config = { schedule: "0-47 13 * * *" };
