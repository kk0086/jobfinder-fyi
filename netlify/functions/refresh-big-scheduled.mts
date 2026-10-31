import type { Config } from "@netlify/functions";
import { runChunk } from "../lib/store.mts";
import { FEED_CHUNKS } from "../lib/crawl.mts";
import { BIG } from "../lib/big.mts";

// One big company per run, every 2 minutes from 13:50 UTC, each with its own 30-second budget.
export default async () => {
  const d = new Date();
  const i = Math.floor(((d.getUTCHours() - 13) * 60 + d.getUTCMinutes() - 50) / 2);
  if (i < 0 || i >= BIG.length) return;
  const r = await runChunk(FEED_CHUNKS + i);
  console.log("refresh-big", JSON.stringify(r));
};
export const config: Config = { schedule: "*/2 13-20 * * *" };
