import type { Config } from "@netlify/functions";
import { ccStep } from "../lib/ccweekly.mts";

// Sunday early morning (UTC), every 2 minutes. Each call does one small step of the weekly Common Crawl search
// for new company job boards; once it has finished, later calls return immediately. See lib/ccweekly.mts.
export default async () => {
  try { console.log("cc-weekly", await ccStep()); } catch (e: any) { console.log("cc-weekly error", String(e?.message || e).slice(0, 200)); }
};
export const config: Config = { schedule: "*/2 3-11 * * 0" };
