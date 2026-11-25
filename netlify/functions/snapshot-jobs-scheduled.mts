import type { Config } from "@netlify/functions";
import { loadAll } from "../lib/store.mts";
import { writeJobShards } from "../lib/jobpage.mts";

// Hourly: rebuilds the per-job page data (256 shard blobs plus the job sitemap list).
export default async () => {
  const { jobs } = await loadAll();
  const r = await writeJobShards(jobs);
  console.log("snapshot-jobs", JSON.stringify(r));
};
export const config: Config = { schedule: "55 * * * *" };
