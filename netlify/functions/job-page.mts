import type { Config } from "@netlify/functions";
import { findJob, renderJob, renderClosed, jobSlug, SLUG_RE } from "../lib/jobpage.mts";

// /job/<company>-<title>-<id>: one indexable page per job, read from the job shards written by snapshot-jobs-scheduled.
export default async (req: Request) => {
  const slug = decodeURIComponent(new URL(req.url).pathname.replace(/^\/job\//, "").replace(/\/+$/, "")).toLowerCase();
  const m = slug.match(SLUG_RE);
  if (!m) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  const { rec, shardOk } = await findJob(m[2]);
  if (!shardOk) return new Response("Job pages are being prepared. Try again shortly.", { status: 503, headers: { "content-type": "text/plain", "retry-after": "600" } });
  if (!rec) return new Response(renderClosed(slug), { status: 410, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", "netlify-cdn-cache-control": "public, durable, s-maxage=1800, stale-while-revalidate=3600" } });
  const canon = jobSlug({ company: rec.c, title: rec.t, url: rec.u });
  if (canon !== slug) return new Response(null, { status: 301, headers: { location: "/job/" + canon, "cache-control": "public, max-age=3600" } });
  return new Response(renderJob(rec), { headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "public, max-age=300",
    "netlify-cdn-cache-control": "public, durable, s-maxage=3600, stale-while-revalidate=86400",
  } });
};
export const config: Config = { path: "/job/:slug", method: ["GET"] };
