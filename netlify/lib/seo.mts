import type { Job } from "./normalize.mts";

// Landing pages for common job searches. Each is a real server-rendered page listing current roles, so search engines
// can read it without running the dashboard.
export type Landing = {
  slug: string; h1: string; title: string; intro: string[]; query: string; related: string[];
  match: (j: Job) => boolean;
};
const t = (j: Job) => (j.title || "").toLowerCase();
const has = (re: RegExp) => (j: Job) => re.test(t(j));
const eng = /engineer|developer|architect|scientist|researcher|programmer/;

export const LANDINGS: Landing[] = [
  { slug: "software-engineer", h1: "Software Engineer Jobs", title: "Software Engineer Jobs: Latest Openings at Top Tech Companies",
    query: "software engineer", related: ["ai-engineer", "full-stack-developer", "devops-engineer", "security-engineer"],
    intro: ["Browse current software engineering openings from technology companies, collected straight from their own careers pages. Roles include backend, frontend, mobile, platform and infrastructure positions from startups to the largest tech employers.", "Listings are refreshed every morning, and each job links to the employer's own application page."],
    match: j => j.role === "Software engineering" && /engineer|developer|programmer|swe\b/.test(t(j)) },
  { slug: "ai-engineer", h1: "AI & Machine Learning Engineer Jobs", title: "AI Engineer & Machine Learning Jobs: Current Openings",
    query: "machine learning", related: ["data-scientist", "software-engineer", "devops-engineer", "product-manager"],
    intro: ["Current openings for AI engineers, machine learning engineers, applied scientists and research engineers, including roles working on large language models, recommendation systems, computer vision and AI infrastructure.", "Jobs come directly from company careers pages and are updated daily."],
    match: j => /\b(ai|a\.i\.|ml|machine learning|llm|genai|generative|deep learning|nlp|computer vision)\b/.test(t(j)) && eng.test(t(j)) },
  { slug: "full-stack-developer", h1: "Full Stack Developer Jobs", title: "Full Stack Developer Jobs: Latest Openings",
    query: "full stack", related: ["software-engineer", "devops-engineer", "ux-designer", "ai-engineer"],
    intro: ["Full stack developer and full stack engineer openings that span front-end and back-end work, from product startups to established software companies.", "Each listing links to the employer's own application page, and the list refreshes daily."],
    match: has(/full[- ]?stack/) },
  { slug: "devops-engineer", h1: "DevOps, SRE & Infrastructure Engineer Jobs", title: "DevOps, Site Reliability & Infrastructure Engineer Jobs",
    query: "devops", related: ["security-engineer", "software-engineer", "ai-engineer", "full-stack-developer"],
    intro: ["Openings for DevOps engineers, site reliability engineers, platform engineers and cloud infrastructure specialists who keep large systems fast and reliable.", "Roles are gathered from company careers pages and refreshed every morning."],
    match: has(/devops|site reliability|\bsre\b|platform engineer|infrastructure engineer|cloud engineer|systems engineer|production engineer/) },
  { slug: "security-engineer", h1: "Security Engineer Jobs", title: "Security Engineer & Cybersecurity Jobs: Current Openings",
    query: "security", related: ["devops-engineer", "software-engineer", "ai-engineer", "data-scientist"],
    intro: ["Current security engineering and cybersecurity openings, including application security, detection and response, security architecture and research roles.", "Listings link straight to each employer's careers page and update daily."],
    match: j => /security|appsec|infosec|cyber/.test(t(j)) && /engineer|architect|researcher|developer|analyst/.test(t(j)) },
  { slug: "data-scientist", h1: "Data Scientist Jobs", title: "Data Scientist Jobs: Latest Openings",
    query: "data scientist", related: ["ai-engineer", "software-engineer", "product-manager", "ux-designer"],
    intro: ["Openings for data scientists, applied scientists and decision scientists who turn product and business data into decisions, experiments and models.", "Each job comes from the company's own careers page and the list refreshes daily."],
    match: has(/data scientist|applied scientist|research scientist|decision scientist|data science/) },
  { slug: "product-manager", h1: "Product Manager Jobs", title: "Product Manager Jobs: Latest Openings at Top Tech Companies",
    query: "product manager", related: ["ux-designer", "data-scientist", "software-engineer", "marketing-manager"],
    intro: ["Current product management openings from technology companies, from associate and senior product managers to principal, group and director roles, including Trust & Safety, payments, AI and platform products.", "Roles are collected from company careers pages and updated every morning, with posted salary ranges shown where employers publish them."],
    match: j => j.role === "Product management" && /product (manager|management|lead|owner)|\bpm\b|group product|head of product|director.*product|product director/.test(t(j)) },
  { slug: "ux-designer", h1: "UX & Product Designer Jobs", title: "UX Designer & Product Designer Jobs: Current Openings",
    query: "design", related: ["product-manager", "full-stack-developer", "marketing-manager", "data-scientist"],
    intro: ["Openings for UX designers, product designers, interaction designers and design leads at technology companies.", "Listings link to the employer's own application page and refresh daily."],
    match: j => /(ux|ui|product|interaction|visual|experience|service) design|designer|researcher.*ux|ux research/.test(t(j)) && (j.role === "UX design" || /ux|product design/.test(t(j))) },
  { slug: "marketing-manager", h1: "Marketing Manager Jobs", title: "Marketing Manager Jobs at Tech Companies: Latest Openings",
    query: "marketing manager", related: ["product-manager", "recruiter", "ux-designer", "data-scientist"],
    intro: ["Marketing manager, growth marketing and brand roles at technology companies, including product marketing, lifecycle, content and demand generation positions.", "Jobs are gathered from company careers pages and updated daily."],
    match: j => j.role === "Marketing" && /manager|director|head|lead/.test(t(j)) },
  { slug: "business-development", h1: "Business Development & Partnerships Jobs", title: "Business Development, Partnerships & Growth Jobs: Current Openings",
    query: "partnerships", related: ["sales", "marketing-manager", "product-manager", "recruiter", "software-engineer"],
    intro: ["Current openings in business development, strategic partnerships, alliances, channel and growth leadership at technology companies, from partnership managers to heads of growth and corporate development.", "Roles are collected from company careers pages and refreshed every morning, with posted salary ranges shown where employers publish them."],
    match: j => j.role === "Bizdev" },
  { slug: "recruiter", h1: "Recruiter & Talent Acquisition Jobs", title: "Recruiter & Talent Acquisition Jobs: Current Openings",
    query: "recruiter", related: ["marketing-manager", "product-manager", "software-engineer", "ux-designer"],
    intro: ["Recruiter, technical recruiter, sourcer and talent acquisition openings at technology companies, from coordinators to talent leaders.", "Roles come from company careers pages and refresh every morning."],
    match: has(/recruit|talent acquisition|sourcer|talent partner/) },
  { slug: "sales", h1: "Sales Jobs", title: "Sales Jobs at Tech Companies: Account Executive, SDR & Sales Leadership Openings",
    query: "sales", related: ["business-development", "customer-service", "marketing-manager", "recruiter"],
    intro: ["Current sales openings at technology and consumer companies, including account executives, sales development reps, enterprise and solutions sales, retail sales and sales leadership roles.", "Jobs are collected straight from each employer's careers page and refreshed every morning, with posted pay ranges shown where employers publish them."],
    match: j => j.role === "Sales" },
  { slug: "customer-service", h1: "Customer Service & Support Jobs", title: "Customer Service & Customer Support Jobs: Current Openings",
    query: "customer support", related: ["sales", "supply-chain-analyst", "recruiter", "business-development"],
    intro: ["Customer service, customer support, technical support and customer success openings at technology and consumer companies, from support specialists and agents to team leads and support managers.", "Every listing links to the employer's own application page, and the list refreshes daily."],
    match: j => j.role === "Customer support" },
  { slug: "supply-chain-analyst", h1: "Supply Chain Analyst Jobs", title: "Supply Chain Analyst & Planner Jobs: Current Openings",
    query: "supply chain analyst", related: ["customer-service", "sales", "business-development", "data-scientist"],
    intro: ["Openings for supply chain analysts, demand and supply planners, logistics analysts, procurement and sourcing specialists and inventory planners at technology, retail and consumer companies.", "Roles come directly from company careers pages and are refreshed every morning."],
    match: j => j.role === "Supply chain & logistics" && /analyst|analytics|planner|planning|forecast|procurement|sourcing|buyer|coordinator|specialist|logistics (manager|lead)|supply chain (manager|lead)/.test(t(j)) },
];
export const bySlug = (s: string) => LANDINGS.find(l => l.slug === s);

const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const SYM: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", CAD: "C$", AUD: "A$" };
const money = (n: number, cur = "USD") => (SYM[cur] || cur + " ") + Math.round(n / 1000) + "K";
const ORIGIN = "https://jobfinder.fyi";
const CSS = `:root{--bg:#fafaf8;--card:#fff;--ink:#1d1d1b;--muted:#6b6b66;--line:#e6e5df;--link:#0f566f;--accent:#f96b4c;--pay:#0b7a4b}@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--ink:#ecebe6;--muted:#9a9990;--line:#2f2f2b;--link:#7cc4dc;--pay:#4cc38a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}a{color:var(--link)}
.w{max-width:960px;margin:0 auto;padding:18px 16px 50px}.logo img{height:56px;width:56px;display:block}.crumb{color:var(--muted);font-size:13px;margin:14px 0 4px}.crumb a{color:var(--muted)}
h1{font-size:30px;line-height:1.2;margin:4px 0 10px}h2{font-size:17px;margin:26px 0 10px}.stats{display:flex;flex-wrap:wrap;gap:10px 22px;margin:14px 0}.stats span{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 14px}
.note{color:var(--muted)}.cta{display:inline-block;background:var(--accent);color:#1d1d1b;font-weight:700;text-decoration:none;border-radius:10px;padding:10px 18px;margin:8px 0}
ul.jobs{list-style:none;margin:0;padding:0}.jobs li{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:0 0 8px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.jobs li>a{flex:1;min-width:0;padding:12px 14px;text-decoration:none;color:inherit;display:block}.jobs .t{display:block;font-weight:600;color:var(--link)}.jobs .c{display:block;color:var(--muted);font-size:13px;margin-top:2px}.jobs .d{color:var(--muted);font-size:12px;padding:12px 14px;white-space:nowrap}.pay{color:var(--pay)}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.box{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px}.box h3{margin:0 0 6px;font-size:14px}.box ul{list-style:none;margin:0;padding:0}.box li{display:flex;justify-content:space-between;padding:3px 0;border-top:1px solid var(--line)}.box li:first-child{border:0}.box li span{color:var(--muted)}
.rel{display:flex;flex-wrap:wrap;gap:8px}.rel a{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:6px 14px;text-decoration:none}
footer{margin-top:34px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:13px;display:flex;gap:16px;flex-wrap:wrap}footer a{color:var(--muted)}
@media (max-width:560px){h1{font-size:24px}.jobs li{flex-direction:column;gap:0}.jobs .d{padding:0 14px 10px}}.ans{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:10px;padding:12px 16px;margin:14px 0}.ans p{margin:0}table.win{border-collapse:collapse;width:100%;margin:8px 0;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}table.win th,table.win td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line)}table.win td.n,table.win th.n{text-align:right;font-variant-numeric:tabular-nums}table.win tr:last-child td{border-bottom:0}.faq h3{font-size:15px;margin:16px 0 4px}.faq p{margin:0}`;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
const ago = (iso?: string | null) => { if (!iso) return ""; const d = (Date.now() - Date.parse(iso)) / 864e5; if (!(d >= 0)) return ""; return d < 1 ? "Posted today" : d < 30 ? `Posted ${Math.round(d)}d ago` : ""; };


// ---- Daily market numbers (computed from the jobs we hold each time the page is rebuilt) ----
export const HUB_SLUG = "new-jobs-today";
const DAY = 864e5;
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const num = (n: number) => n.toLocaleString("en-US");
// Roles with a real posting date inside the window (future-dated postings are ignored).
const postedAt = (j: Job, now: number) => { const t = Date.parse((j as any).posted || ""); return t && t <= now + 36e5 ? t : 0; };
function windows(jobs: Job[], now: number) {
  let d1 = 0, d7 = 0, d30 = 0, dated = 0;
  for (const j of jobs) { const t = postedAt(j, now); if (!t) continue; dated++; const a = now - t; if (a <= DAY) d1++; if (a <= 7 * DAY) d7++; if (a <= 30 * DAY) d30++; }
  return { d1, d7, d30, dated };
}
const topNew = (jobs: Job[], now: number, days: number) => { const m = new Map<string, number>(); for (const j of jobs) { const t = postedAt(j, now); if (t && now - t <= days * DAY) m.set(j.company, (m.get(j.company) || 0) + 1); } return top(m, 5); };
const fmtList = (a: [string, number][]) => a.map(([c, n]) => `${c} (${num(n)})`).join(", ");
type QA = { q: string; a: string };
const faqHtml = (qa: QA[]) => `<section class="faq"><h2>Frequently asked questions</h2>${qa.map(x => `<h3>${esc(x.q)}</h3><p>${esc(x.a)}</p>`).join("")}</section>`;
const faqLd = (qa: QA[]) => ({ "@type": "FAQPage", mainEntity: qa.map(x => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })) });
const UPDATE_QA: QA = { q: "How often is this page updated?", a: "Job Finder reads employers' own careers pages every day, and the busiest hiring companies several times a day. The counts on this page are recalculated each time new listings arrive." };

export function renderLanding(l: Landing, all: Job[], asOf: string): { html: string; count: number } {
  const jobs = all.filter(l.match).filter(j => j.url && j.title);
  const count = jobs.length;
  const ts = (j: Job) => Date.parse((j as any).posted || "") || 0;
  const list = [...jobs].sort((a, b) => ts(b) - ts(a)).slice(0, 50);
  const cos = new Map<string, number>(), locs = new Map<string, number>();
  let remote = 0; const lo: number[] = [], hi: number[] = [];
  for (const j of jobs) {
    cos.set(j.company, (cos.get(j.company) || 0) + 1);
    for (const s of (j.states || []) as string[]) if (s && !/^(Unspecified|Remote)/.test(s)) locs.set(s, (locs.get(s) || 0) + 1);
    if (j.remote) remote++;
    if ((j as any).salary_min && ((j as any).salary_cur || "USD") === "USD") { lo.push((j as any).salary_min); hi.push((j as any).salary_max || (j as any).salary_min); }
  }
  const nCo = cos.size, pct = count ? Math.round(remote / count * 100) : 0;
  const now = Date.now(), what = l.h1.replace(/ Jobs$/, ""), W = windows(jobs, now), today = fmtDate(now);
  const cov = count ? Math.round(W.dated / count * 100) : 0;
  const covNote = cov && cov < 95 ? ` Posting dates are available for ${cov}% of these listings, so the new-job counts are a minimum.` : "";
  const answer = `As of ${today}, Job Finder lists ${num(count)} open ${what} jobs from ${num(nCo)} ${nCo === 1 ? "company" : "companies"}. ${num(W.d1)} ${W.d1 === 1 ? "was" : "were"} posted in the last 24 hours, ${num(W.d7)} in the last 7 days and ${num(W.d30)} in the last 30 days.${covNote}`;
  const topLocN = top(locs, 5), topNew7 = topNew(jobs, now, 7);
  const qa: QA[] = [
    { q: `How many ${what} jobs are open right now?`, a: `As of ${today}, there are ${num(count)} open ${what} jobs from ${num(nCo)} companies on Job Finder.` },
    { q: `How many new ${what} jobs were posted in the last 24 hours?`, a: `${num(W.d1)} new ${what} jobs were posted in the last 24 hours, ${num(W.d7)} in the last 7 days and ${num(W.d30)} in the last 30 days (as of ${today}).${covNote}` },
    ...(top(cos, 5).length ? [{ q: `Which companies have the most ${what} openings?`, a: `The companies with the most open ${what} jobs are ${fmtList(top(cos, 5))}.` }] : []),
    ...(W.d7 >= 5 && topNew7.length ? [{ q: `Which companies posted the most new ${what} jobs this week?`, a: `In the last 7 days the most new ${what} jobs were posted by ${fmtList(topNew7)}.` }] : []),
    ...(topLocN.length ? [{ q: `Where are most ${what} jobs located?`, a: `The most ${what} jobs are in ${fmtList(topLocN)}. About ${pct}% are remote-friendly.` }] : []),
    ...(lo.length >= 5 ? [{ q: `How much do ${what} jobs pay?`, a: `Among the ${num(lo.length)} ${what} jobs that list pay, the typical range is ${money(median(lo))} to ${money(median(hi))} a year in USD. Many employers do not publish pay, so this covers only listings that do.` }] : []),
    UPDATE_QA,
  ];
  const stats = [`<b>${count.toLocaleString()}</b> open roles`, `<b>${nCo.toLocaleString()}</b> companies`, `<b>${pct}%</b> remote-friendly`];
  const payLine = lo.length >= 5 ? `<p class="note">Among the ${lo.length.toLocaleString()} roles that list pay, the typical range is <b>${money(median(lo))}–${money(median(hi))}</b> a year (USD).</p>` : "";
  const topCo = top(cos, 8).map(([c, n]) => `<li>${esc(c)} <span>${n}</span></li>`).join("");
  const topLoc = top(locs, 8).map(([c, n]) => `<li>${esc(c)} <span>${n}</span></li>`).join("");
  const rows = list.map(j => {
    const pay = (j as any).salary_min ? ` · <b class="pay">${money((j as any).salary_min, (j as any).salary_cur)}${(j as any).salary_max && (j as any).salary_max !== (j as any).salary_min ? "–" + money((j as any).salary_max, (j as any).salary_cur).replace(/^\D+/, "") : ""}</b>` : "";
    return `<li><a href="${esc(j.url)}" rel="nofollow noopener" target="_blank"><span class="t">${esc(j.title)}</span><span class="c">${esc(j.company)} · ${esc(j.location || "Location not listed")}${pay}</span></a><span class="d">${esc(ago((j as any).posted))}</span></li>`;
  }).join("");
  const rel = l.related.map(s => bySlug(s)).filter(Boolean).map(r => `<a href="/jobs/${r!.slug}">${esc(r!.h1)}</a>`).join("");
  const url = `${ORIGIN}/jobs/${l.slug}`;
  const title = `${l.h1}: ${num(count)} Open${W.d1 ? `, ${num(W.d1)} New in 24 Hours` : ""}`;
  const desc = `${num(W.d1)} new ${what} jobs in the last 24 hours and ${num(W.d7)} in the last 7 days, out of ${num(count)} open roles at ${num(nCo)} companies. Updated daily.`.slice(0, 160);
  const ld = { "@context": "https://schema.org", "@graph": [
    { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Job Finder", item: ORIGIN + "/" }, { "@type": "ListItem", position: 2, name: l.h1, item: url }] },
    faqLd(qa),
    { "@type": "WebPage", name: title, url, dateModified: new Date(now).toISOString(), isPartOf: { "@type": "WebSite", name: "Job Finder", url: ORIGIN } },
    { "@type": "ItemList", name: l.h1, numberOfItems: list.length, itemListElement: list.slice(0, 20).map((j, i) => ({ "@type": "ListItem", position: i + 1, name: `${j.title} at ${j.company}`, url: j.url })) },
  ] };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | Job Finder</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">${count < 10 ? '<meta name="robots" content="noindex,follow">' : ""}
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:url" content="${url}"><meta property="og:image" content="${ORIGIN}/icon-512.png">
<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<style>${CSS}</style></head>
<body><div class="w"><a class="logo" href="/" aria-label="Job Finder home"><img src="/logo.png?v=2" alt="Job Finder" width="56" height="56"></a>
<nav class="crumb"><a href="/">Job Finder</a> › ${esc(l.h1)}</nav>
<h1>${esc(l.h1)}</h1>
${l.intro.map(p => `<p>${esc(p)}</p>`).join("")}
<div class="ans"><p>${esc(answer)}</p></div>
<div class="stats">${stats.map(s => `<span>${s}</span>`).join("")}</div>${payLine}
<h2>New ${esc(what)} jobs by time posted</h2>
<table class="win"><thead><tr><th>Posted</th><th class="n">${esc(what)} jobs</th></tr></thead><tbody><tr><td>Last 24 hours</td><td class="n">${num(W.d1)}</td></tr><tr><td>Last 7 days</td><td class="n">${num(W.d7)}</td></tr><tr><td>Last 30 days</td><td class="n">${num(W.d30)}</td></tr><tr><td>All open roles</td><td class="n">${num(count)}</td></tr></tbody></table><p class="note">Counted on ${esc(today)} (UTC) from each listing's posting date, using the most recent read of each employer's careers page.${esc(covNote)}</p>
<a class="cta" href="/?q=${encodeURIComponent(l.query)}">Click here to search and filter all ${count.toLocaleString()} roles</a>
<h2>Latest ${esc(l.h1.replace(/ Jobs$/, ""))} jobs</h2>
${rows ? `<ul class="jobs">${rows}</ul>` : "<p>No current openings found. Check back tomorrow.</p>"}
${count > list.length ? `<p><a class="cta" href="/?q=${encodeURIComponent(l.query)}">Click here to search and filter all ${count.toLocaleString()} roles</a></p>` : ""}
<div class="cols"><div class="box"><h3>Top hiring companies</h3><ul>${topCo}</ul></div><div class="box"><h3>Top locations</h3><ul>${topLoc || "<li>Remote and multiple locations</li>"}</ul></div></div>
${faqHtml(qa)}
<h2>Related searches</h2><div class="rel">${rel}<a href="/jobs/${HUB_SLUG}">New jobs today</a><a href="/">All jobs</a></div>
<footer><span>&copy; 2026 Jobfinder.fyi</span><span>Jobs updated daily · data as of ${esc(asOf.slice(0, 10))}</span><a href="/">Search all jobs</a><a href="/privacy.html">Privacy</a></footer></div></body></html>`;
  return { html, count };
}

// /jobs/new-jobs-today: one page answering "how many new jobs were posted in the last 24 hours / this week", across every role family.
export function renderHub(all: Job[], asOf: string): { html: string; count: number } {
  const now = Date.now(), today = fmtDate(now);
  const jobs = all.filter(j => j.url && j.title), count = jobs.length;
  const W = windows(jobs, now), cov = count ? Math.round(W.dated / count * 100) : 0;
  const covNote = cov && cov < 95 ? ` Posting dates are available for ${cov}% of listings, so the new-job counts are a minimum.` : "";
  const cos = new Set(jobs.map(j => j.company));
  const fam = new Map<string, { open: number; d1: number; d7: number; d30: number }>();
  for (const j of jobs) {
    const r = (j as any).role; if (!r) continue;
    const f = fam.get(r) || fam.set(r, { open: 0, d1: 0, d7: 0, d30: 0 }).get(r)!;
    f.open++; const t = postedAt(j, now); if (!t) continue; const a = now - t;
    if (a <= DAY) f.d1++; if (a <= 7 * DAY) f.d7++; if (a <= 30 * DAY) f.d30++;
  }
  const famRows = [...fam].filter(([, f]) => f.open >= 20).sort((a, b) => b[1].d7 - a[1].d7 || b[1].open - a[1].open);
  const topFam = famRows.slice(0, 5).map(([r, f]) => [r, f.d7] as [string, number]);
  const topCo7 = topNew(jobs, now, 7), topCo1 = topNew(jobs, now, 1);
  const url = `${ORIGIN}/jobs/${HUB_SLUG}`;
  const h1 = "New Jobs Today: Openings Posted in the Last 24 Hours";
  const title = `New Jobs: ${num(W.d1)} Posted in 24 Hours, ${num(W.d7)} This Week`;
  const answer = `As of ${today}, ${num(W.d1)} new jobs were posted in the last 24 hours, ${num(W.d7)} in the last 7 days and ${num(W.d30)} in the last 30 days, among ${num(count)} open jobs from ${num(cos.size)} companies on Job Finder.${covNote}`;
  const desc = `${num(W.d1)} new jobs posted in the last 24 hours and ${num(W.d7)} in the last 7 days, by job category and company. Updated daily.`.slice(0, 160);
  const qa: QA[] = [
    { q: "How many new jobs were posted in the last 24 hours?", a: `${num(W.d1)} new jobs were posted in the last 24 hours as of ${today}, out of ${num(count)} open jobs from ${num(cos.size)} companies on Job Finder.${covNote}` },
    { q: "How many new jobs were posted this week?", a: `${num(W.d7)} new jobs were posted in the last 7 days and ${num(W.d30)} in the last 30 days (as of ${today}).` },
    ...(topFam.length ? [{ q: "Which job categories have the most new openings this week?", a: `In the last 7 days the most new jobs were in ${fmtList(topFam)}.` }] : []),
    ...(topCo7.length ? [{ q: "Which companies are posting the most new jobs this week?", a: `In the last 7 days the most new jobs were posted by ${fmtList(topCo7)}.` }] : []),
    UPDATE_QA,
  ];
  const ld = { "@context": "https://schema.org", "@graph": [
    { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Job Finder", item: ORIGIN + "/" }, { "@type": "ListItem", position: 2, name: "New jobs today", item: url }] },
    faqLd(qa),
    { "@type": "WebPage", name: title, url, dateModified: new Date(now).toISOString(), isPartOf: { "@type": "WebSite", name: "Job Finder", url: ORIGIN } },
  ] };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | Job Finder</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:url" content="${url}"><meta property="og:image" content="${ORIGIN}/icon-512.png">
<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<style>${CSS}</style></head>
<body><div class="w"><a class="logo" href="/" aria-label="Job Finder home"><img src="/logo.png?v=2" alt="Job Finder" width="56" height="56"></a>
<nav class="crumb"><a href="/">Job Finder</a> › New jobs today</nav>
<h1>${esc(h1)}</h1>
<div class="ans"><p>${esc(answer)}</p></div>
<h2>New jobs by time posted</h2>
<table class="win"><thead><tr><th>Posted</th><th class="n">New jobs</th></tr></thead><tbody><tr><td>Last 24 hours</td><td class="n">${num(W.d1)}</td></tr><tr><td>Last 7 days</td><td class="n">${num(W.d7)}</td></tr><tr><td>Last 30 days</td><td class="n">${num(W.d30)}</td></tr><tr><td>All open jobs</td><td class="n">${num(count)}</td></tr></tbody></table>
<p class="note">Counted on ${esc(today)} (UTC) from each listing's posting date, using the most recent read of each employer's careers page.${esc(covNote)}</p>
<h2>New jobs by category</h2>
<table class="win"><thead><tr><th>Job category</th><th class="n">24 hours</th><th class="n">7 days</th><th class="n">30 days</th><th class="n">Open</th></tr></thead><tbody>${famRows.map(([r, f]) => `<tr><td>${esc(r)}</td><td class="n">${num(f.d1)}</td><td class="n">${num(f.d7)}</td><td class="n">${num(f.d30)}</td><td class="n">${num(f.open)}</td></tr>`).join("")}</tbody></table>
<div class="cols"><div class="box"><h3>Most new jobs in the last 24 hours</h3><ul>${topCo1.map(([c, n]) => `<li>${esc(c)} <span>${n}</span></li>`).join("") || "<li>No new jobs found</li>"}</ul></div><div class="box"><h3>Most new jobs in the last 7 days</h3><ul>${topCo7.map(([c, n]) => `<li>${esc(c)} <span>${n}</span></li>`).join("")}</ul></div></div>
<a class="cta" href="/">Search and filter all jobs</a>
${faqHtml(qa)}
<h2>Browse by job type</h2><div class="rel">${LANDINGS.map(r => `<a href="/jobs/${r.slug}">${esc(r.h1)}</a>`).join("")}<a href="/">All jobs</a></div>
<footer><span>&copy; 2026 Jobfinder.fyi</span><span>Jobs updated daily · data as of ${esc(asOf.slice(0, 10))}</span><a href="/">Search all jobs</a><a href="/privacy.html">Privacy</a></footer></div></body></html>`;
  return { html, count };
}
