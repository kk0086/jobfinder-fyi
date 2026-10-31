import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { isOwner } from "../lib/auth.mts";
import { getStore as gs } from "@netlify/blobs";
import { TOTAL_BATCHES as CHUNKS } from "../lib/store.mts";
import coverage from "./coverage.json" with { type: "json" };


// Owner-only. The admin key is sent as the x-admin-key header.
const top = (m: Map<string, number>, n = 10) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
const inc = (m: Map<string, number>, k: string, by = 1) => k && m.set(k, (m.get(k) || 0) + by);

export default async (req: Request) => {
  if (!isOwner(req)) return new Response("Unauthorized", { status: 401, headers: { "cache-control": "no-store" } });

  const days = Math.max(1, Math.min(90, +(new URL(req.url).searchParams.get("days") || 30)));
  const store = getStore("sessions");
  const dayList: string[] = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));

  const sessions: any[] = [];
  for (const d of dayList) {
    const { blobs } = await store.list({ prefix: `s/${d}/` });
    for (let i = 0; i < blobs.length && sessions.length < 20000; i += 50) {
      const got = await Promise.all(blobs.slice(i, i + 50).map(b => store.get(b.key, { type: "json" }).catch(() => null)));
      got.forEach(g => g && sessions.push(g));
    }
  }

  const perDay = new Map<string, { sessions: number; visitors: Set<string>; views: number }>();
  dayList.forEach(d => perDay.set(d, { sessions: 0, visitors: new Set(), views: 0 }));
  const visitors = new Set<string>(), returning = new Set<string>();
  const countries = new Map(), devices = new Map(), refs = new Map(), cos = new Map(), titles = new Map();
  const cities = new Map(), regions = new Map(), browsers = new Map(), oss = new Map(), langs = new Map(), screens = new Map(), utms = new Map(), lands = new Map(), hours = new Map(), dows = new Map(), filterUse = new Map(), searchUse = new Map();
  let pagedDeep = 0, usedFilters = 0, usedSearch = 0;
  let views = 0, activeSum = 0, engaged = 0, bounced = 0, clicksTotal = 0;
  const actives: number[] = [];
  const now = Date.now();
  const liveV = new Set<string>();

  for (const s of sessions) {
    const d = new Date(s.start).toISOString().slice(0, 10);
    const p = perDay.get(d); if (p) { p.sessions++; p.visitors.add(s.vid); p.views += s.views; }
    visitors.add(s.vid); if (s.returning) returning.add(s.vid);
    views += s.views; activeSum += s.active; actives.push(s.active);
    if (s.active >= 10) engaged++;
    if (s.active < 5 && !(s.clicks || []).length) bounced++;
    inc(countries, s.country || "Unknown"); inc(devices, s.device); inc(refs, s.ref || "Direct");
    if (s.city) inc(cities, `${s.city}${s.region ? ", " + s.region : ""}${s.country ? " (" + s.country + ")" : ""}`);
    if (s.region && s.country) inc(regions, `${s.region}, ${s.country}`);
    if (s.browser) inc(browsers, s.browser); if (s.os) inc(oss, s.os);
    if (s.lang) inc(langs, s.lang); if (s.scr) inc(screens, s.scr); if (s.utm) inc(utms, s.utm); if (s.land) inc(lands, s.land);
    try { const tz = s.gtz || s.tz || "UTC"; const lt = new Date(new Date(s.start).toLocaleString("en-US", { timeZone: tz }));
      inc(hours, String(lt.getHours()).padStart(2, "0") + ":00"); inc(dows, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][lt.getDay()]); } catch {}
    if ((s.f || []).length) usedFilters++; if ((s.q || []).length) usedSearch++; if ((s.pg || 0) > 0) pagedDeep++;
    (s.f || []).forEach((f: string) => inc(filterUse, f));
    (s.q || []).forEach((q: string) => inc(searchUse, q));
    (s.clicks || []).forEach((c: any) => { clicksTotal++; inc(cos, c.co); inc(titles, `${c.co}: ${c.t}`); });
    if (now - s.last < 2 * 60 * 1000) liveV.add(s.vid);
  }
  actives.sort((a, b) => a - b);
  const n = sessions.length;

  const body = {
    days, generated: now,
    totals: {
      visitors: visitors.size, returningVisitors: returning.size, sessions: n, pageviews: views,
      avgActiveSec: n ? Math.round(activeSum / n) : 0, medianActiveSec: n ? Math.round(actives[Math.floor(n / 2)]) : 0,
      totalActiveHours: +(activeSum / 3600).toFixed(1), engagedPct: n ? Math.round(engaged / n * 100) : 0,
      bouncePct: n ? Math.round(bounced / n * 100) : 0, jobClicks: clicksTotal, liveNow: liveV.size,
    },
    daily: dayList.map(d => { const p = perDay.get(d)!; return { d, sessions: p.sessions, visitors: p.visitors.size, views: p.views }; }),
    cities: top(cities, 12), regions: top(regions, 10), browsers: top(browsers, 6), systems: top(oss, 6), languages: top(langs, 8), screens: top(screens, 8), campaigns: top(utms, 8), landing: top(lands, 6),
    hours: [...Array(24).keys()].map(h => { const k = String(h).padStart(2, "0") + ":00"; return [k, hours.get(k) || 0]; }), weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(k => [k, dows.get(k) || 0]),
    filters: top(filterUse, 12), searches: top(searchUse, 12), usage: { usedFilters, usedSearch, pagedDeep },
    countries: top(countries), devices: top(devices), referrers: top(refs), topCompanies: top(cos), topJobs: top(titles),
    recent: sessions.sort((a, b) => b.last - a.last).slice(0, 25).map(s => ({
      when: s.last, country: s.country, city: s.city, region: s.region, browser: s.browser, os: s.os, device: s.device, ref: s.ref, active: s.active, views: s.views, clicks: (s.clicks || []).length, returning: s.returning,
    })),
    truncated: sessions.length >= 20000,
    coverage,
    refresh: await Promise.all(Array.from({ length: CHUNKS }, async (_, i) => {
      const b: any = await gs("feed").get(`v2-chunk-${i}`, { type: "json" }).catch(() => null);
      return b ? { chunk: i, at: b.at, companies: b.report.length, failed: b.report.filter((r: any) => !r.ok).map((r: any) => r.name + (r.error ? ` (${r.error})` : "")), roles: b.jobs.length } : { chunk: i, at: null };
    })),
  };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};

export const config: Config = { path: "/api/stats", method: ["GET"] };
