import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

// Receives one anonymous session record per visit and overwrites it as the visit goes on.
// No IP address is stored. Country, city and region come from Netlify's edge geo data (city-level only).
const ID = /^[a-z0-9-]{8,40}$/i;
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|curl|wget|python|monitor/i;

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return new Response("ok");
  const ua = req.headers.get("user-agent") || "";
  if (BOT.test(ua)) return new Response(null, { status: 204 });
  let b: any;
  try { b = JSON.parse(await req.text()); } catch { return new Response(null, { status: 400 }); }
  if (!b || !ID.test(b.sid || "") || !ID.test(b.vid || "")) return new Response(null, { status: 400 });

  const start = Number.isFinite(b.start) ? Math.min(+b.start, Date.now()) : Date.now();
  const day = new Date(start).toISOString().slice(0, 10);
  let ref = "";
  try { ref = b.ref ? new URL(String(b.ref)).hostname.replace(/^www\./, "") : ""; } catch {}
  if (ref.endsWith("jobfinder.fyi")) ref = "";
  const device = /mobile|iphone|android/i.test(ua) ? "Mobile" : /ipad|tablet/i.test(ua) ? "Tablet" : "Desktop";
  const clicks = Array.isArray(b.clicks) ? b.clicks.slice(0, 25).map((c: any) => ({ co: String(c.co || "").slice(0, 80), t: String(c.t || "").slice(0, 140) })) : [];

  const g: any = context.geo || {};
  const browser = /edg\//i.test(ua) ? "Edge" : /opr\/|opera/i.test(ua) ? "Opera" : /firefox|fxios/i.test(ua) ? "Firefox" : /chrome|crios/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "Other";
  const os = /iphone|ipad|ipod/i.test(ua) ? "iOS" : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows" : /mac os|macintosh/i.test(ua) ? "macOS" : /cros/i.test(ua) ? "ChromeOS" : /linux/i.test(ua) ? "Linux" : "Other";
  const clean = (v: any, n: number) => String(v || "").slice(0, n);
  const list = (v: any, n: number, w: number) => Array.isArray(v) ? v.slice(0, n).map((x: any) => clean(x, w)).filter(Boolean) : [];
  const rec = {
    sid: b.sid, vid: b.vid, start, last: Date.now(),
    active: Math.max(0, Math.min(+b.active || 0, 4 * 3600)), // seconds of visible, focused time
    views: Math.max(1, Math.min(+b.views || 1, 500)),
    returning: !!b.returning,
    ref, device, country: g.country?.code || "", city: clean(g.city, 60), region: clean(g.subdivision?.code || g.subdivision?.name, 40), gtz: clean(g.timezone, 40),
    browser, os, lang: clean(b.lang, 12), scr: clean(b.scr, 12), tz: clean(b.tz, 40), utm: clean(b.utm, 80), land: clean(b.land, 60),
    f: list(b.f, 40, 70), q: list(b.q, 12, 40), pg: Math.max(0, Math.min(+b.pg || 0, 500)), clicks,
  };
  await getStore("sessions").setJSON(`s/${day}/${b.sid}`, rec);
  return new Response(null, { status: 204 });
};

export const config: Config = { path: "/api/collect", method: ["POST"] };
