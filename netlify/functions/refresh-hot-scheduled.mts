import type { Config } from "@netlify/functions";
import { runHot } from "../lib/store.mts";

// The busiest hirers are re-read every 30 minutes, around the clock (the hourly and daily passes cover everyone else).
export default async () => {
  const r = await runHot();
  console.log("refresh-hot", JSON.stringify(r));
};
export const config: Config = { schedule: "20,50 * * * *" };
