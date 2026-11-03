import type { Config } from "@netlify/functions";
import { jobsPayload } from "../lib/store.mts";

// /api/jobs?region=us|ca|uk|ie|emea (default us)
export default async (req: Request) => {
  const body = await jobsPayload(new URL(req.url).searchParams.get("region") || "us");
  return new Response(body as unknown as BodyInit, { headers: { "content-type": "application/json", "content-encoding": "gzip", "cache-control": "public, max-age=60" } });
};
export const config: Config = { path: "/api/jobs", method: ["GET"] };
