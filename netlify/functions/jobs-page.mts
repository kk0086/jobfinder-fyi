import type { Config } from "@netlify/functions";
import { loadAll } from "../lib/store.mts";
import { bySlug, renderLanding } from "../lib/seo.mts";

// Public landing pages: /jobs/<slug>. Rendered from the same daily data as the dashboard and cached at the CDN.
const memo = new Map<string, { t: number; html: string }>();
export default async (req: Request) => {
  const slug = new URL(req.url).pathname.replace(/^\/jobs\//, "").replace(/\/+$/, "");
  const l = bySlug(slug);
  if (!l) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  const hit = memo.get(slug);
  let html = hit && Date.now() - hit.t < 30 * 60 * 1000 ? hit.html : "";
  if (!html) {
    const { jobs, at } = await loadAll();
    html = renderLanding(l, jobs as any, at || new Date().toISOString()).html;
    memo.set(slug, { t: Date.now(), html });
  }
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=600", "netlify-cdn-cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
};
export const config: Config = { path: "/jobs/:slug", method: ["GET"] };
