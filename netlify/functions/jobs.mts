import type { Config } from "@netlify/functions";
import { jobsPayload } from "../lib/store.mts";

export default async () => {
  const body = await jobsPayload();
  return new Response(body, { headers: { "content-type": "application/json", "content-encoding": "gzip", "cache-control": "public, max-age=60" } });
};
export const config: Config = { path: "/api/jobs", method: ["GET"] };
