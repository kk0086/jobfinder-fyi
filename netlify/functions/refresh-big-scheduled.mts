import type { Config } from "@netlify/functions";
import { runChunk } from "../lib/store.mts";
import { FEED_CHUNKS } from "../lib/crawl.mts";
import { BIG } from "../lib/big.mts";

// One big company per run, every 2 minutes from 13:24 UTC (up to 18 companies), each with its own 30-second budget.
export default async () => {
  const i = Math.min(BIG.length - 1, Math.max(0, Math.floor((new Date().getUTCMinutes() - 24) / 2)));
  const r = await runChunk(FEED_CHUNKS + i);
  console.log("refresh-big", JSON.stringify(r));
};
export const config: Config = { schedule: "24,26,28,30,32,34,36,38,40,42,44,46,48,50,52,54,56,58 13 * * *" };
