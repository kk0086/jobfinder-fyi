import type { Config } from "@netlify/functions";
import { LANDINGS } from "../lib/seo.mts";

// /sitemap.xml: the home page, the privacy page and every job landing page.
export default async () => {
  const day = new Date().toISOString().slice(0, 10);
  const u = (p: string, freq: string, pri: string) => `  <url><loc>https://jobfinder.fyi${p}</loc><lastmod>${day}</lastmod><changefreq>${freq}</changefreq><priority>${pri}</priority></url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[u("/", "daily", "1.0"), ...LANDINGS.map(l => u("/jobs/" + l.slug, "daily", "0.8")), u("/privacy.html", "yearly", "0.3")].join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
};
export const config: Config = { path: "/sitemap.xml", method: ["GET"] };
