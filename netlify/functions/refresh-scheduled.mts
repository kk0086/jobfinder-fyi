import type { Config } from "@netlify/functions";
import { runChunk } from "../lib/store.mts";
import { CHUNKS } from "../lib/crawl.mts";

// Fires six times in a row each morning (13:00-13:20 UTC); each run reads one sixth of the company job boards.
export default async () => {
  const chunk = Math.min(CHUNKS - 1, Math.floor(new Date().getUTCMinutes() / 4));
  const r = await runChunk(chunk);
  console.log("refresh", JSON.stringify(r));
};

export const config: Config = { schedule: "0,4,8,12,16,20 13 * * *" };
