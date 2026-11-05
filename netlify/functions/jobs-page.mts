import type { Config } from "@netlify/functions";
import { loadAll, snapshotPage } from "../lib/store.mts";
import { bySlug, renderLanding } from "../lib/seo.mts";

// Public landing pages: /jobs/<slug>. Served from the prebuilt snapshot (snapshot-scheduled) and cached at the CDN;
// rendered live only if the snapshot is missing or stale.
const memo = new Map<string, { t: number; html: string }>();
export default async (req: Request) => {
  const slug = new URL(req.url).pathname.replace(/^\/jobs\//, "").replace(/\/+$/, "");
  const l = bySlug(slug);
  if (!l) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  const hit = memo.get(slug);
  let html = hit && Date.now() - hit.t < 30 * 60 * 1000 ? hit.html : "";
  if (!html) html = (await snapshotPage(slug)) || "";
  if (!html) {
    const { jobs, at } = await loadAll();
    html = renderLanding(l, jobs as any, at || new Date().toISOString()).html;
  }
  memo.set(slug, { t: Date.now(), html });
  return new Response(html, { headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "public, max-age=600",
    "netlify-cdn-cache-control": "public, durable, s-maxage=3600, stale-while-revalidate=86400",
  } });
};
export const config: Config = { path: "/jobs/:slug", method: ["GET"] };
