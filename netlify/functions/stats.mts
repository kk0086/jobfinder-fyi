import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { isOwner } from "../lib/auth.mts";
import { getStore as gs } from "@netlify/blobs";
import { CHUNKS } from "../lib/crawl.mts";
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
    countries: top(countries), devices: top(devices), referrers: top(refs), topCompanies: top(cos), topJobs: top(titles),
    recent: sessions.sort((a, b) => b.last - a.last).slice(0, 25).map(s => ({
      when: s.last, country: s.country, device: s.device, ref: s.ref, active: s.active, views: s.views, clicks: (s.clicks || []).length, returning: s.returning,
    })),
    truncated: sessions.length >= 20000,
    coverage,
    refresh: await Promise.all(Array.from({ length: CHUNKS }, async (_, i) => {
      const b: any = await gs("feed").get(`chunk-${i}`, { type: "json" }).catch(() => null);
      return b ? { chunk: i, at: b.at, companies: b.report.length, failed: b.report.filter((r: any) => !r.ok).map((r: any) => r.name + (r.error ? ` (${r.error})` : "")), roles: b.jobs.length } : { chunk: i, at: null };
    })),
  };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};

export const config: Config = { path: "/api/stats", method: ["GET"] };
