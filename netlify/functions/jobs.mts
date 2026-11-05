import type { Config } from "@netlify/functions";
import { jobsPayload } from "../lib/store.mts";

// /api/jobs?region=us|ca|uk|ie|emea (default us). Served from the prebuilt snapshot and cached at Netlify's CDN.
export default async (req: Request) => {
  const body = await jobsPayload(new URL(req.url).searchParams.get("region") || "us");
  return new Response(body as unknown as BodyInit, { headers: {
    "content-type": "application/json", "content-encoding": "gzip",
    "cache-control": "public, max-age=300",
    // Shared across all CDN nodes ("durable"); fresh for 15 min, then served stale while one request refreshes it.
    "netlify-cdn-cache-control": "public, durable, s-maxage=900, stale-while-revalidate=86400",
    "netlify-vary": "query=region",
  } });
};
export const config: Config = { path: "/api/jobs", method: ["GET"] };
