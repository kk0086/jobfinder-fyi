import type { Config } from "@netlify/functions";
import { runChunk } from "../lib/store.mts";
import { FEED_CHUNKS } from "../lib/crawl.mts";
import { BIG } from "../lib/big.mts";

// One big company per run, every 3 minutes from 13:24 UTC, each with its own 30-second budget.
export default async () => {
  const i = Math.min(BIG.length - 1, Math.max(0, Math.floor((new Date().getUTCMinutes() - 24) / 3)));
  const r = await runChunk(FEED_CHUNKS + i);
  console.log("refresh-big", JSON.stringify(r));
};
export const config: Config = { schedule: "24,27,30,33,36,39,42,45,48 13 * * *" };
