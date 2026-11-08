import type { Config } from "@netlify/functions";
import { jobsPayload } from "../lib/store.mts";

// /api/jobs-more?region=us|ca|uk|ie|emea: the big job families (Sales, Customer support, Supply chain & logistics), loaded on demand.
export default async (req: Request) => {
  const body = await jobsPayload(new URL(req.url).searchParams.get("region") || "us", false, true);
  return new Response(body as unknown as BodyInit, { headers: {
    "content-type": "application/json", "content-encoding": "gzip",
    "cache-control": "public, max-age=300",
    "netlify-cdn-cache-control": "public, durable, s-maxage=900, stale-while-revalidate=86400",
    "netlify-vary": "query=region",
  } });
};
export const config: Config = { path: "/api/jobs-more", method: ["GET"] };
