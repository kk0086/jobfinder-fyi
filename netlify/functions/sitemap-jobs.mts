import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// /sitemap-jobs.xml: recent job pages (see MAP_DAYS / MAP_MAX in lib/jobpage.mts). A job leaves this list when it closes.
export default async () => {
  const map = ((await getStore("feed").get("snap-job-sitemap", { type: "json" }).catch(() => null)) as [string, string][] | null) || [];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${map.map(([s, d]) => `  <url><loc>https://jobfinder.fyi/job/${s}</loc><lastmod>${d}</lastmod></url>`).join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=1800" } });
};
export const config: Config = { path: "/sitemap-jobs.xml", method: ["GET"] };
