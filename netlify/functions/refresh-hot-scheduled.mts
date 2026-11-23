import type { Config } from "@netlify/functions";
import { runHot } from "../lib/store.mts";

// The busiest hirers are re-read five more times a day (the daily 13:00 UTC pass covers everyone). Hours avoid the 13:00-20:00 UTC refresh window.
export default async () => {
  const r = await runHot();
  console.log("refresh-hot", JSON.stringify(r));
};
export const config: Config = { schedule: "20 1,5,9,17,21 * * *" };
