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
  { slug: "recruiter", h1: "Recruiter & Talent Acquisition Jobs", title: "Recruiter & Talent Acquisition Jobs: Current Openings",
    query: "recruiter", related: ["marketing-manager", "product-manager", "software-engineer", "ux-designer"],
    intro: ["Recruiter, technical recruiter, sourcer and talent acquisition openings at technology companies, from coordinators to talent leaders.", "Roles come from company careers pages and refresh every morning."],
    match: has(/recruit|talent acquisition|sourcer|talent partner/) },
];
export const bySlug = (s: string) => LANDINGS.find(l => l.slug === s);

const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const SYM: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", CAD: "C$", AUD: "A$" };
const money = (n: number, cur = "USD") => (SYM[cur] || cur + " ") + Math.round(n / 1000) + "K";
const ORIGIN = "https://jobfinder.fyi";
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
const ago = (iso?: string | null) => { if (!iso) return ""; const d = (Date.now() - Date.parse(iso)) / 864e5; if (!(d >= 0)) return ""; return d < 1 ? "Posted today" : d < 30 ? `Posted ${Math.round(d)}d ago` : ""; };

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
  const desc = `${count.toLocaleString()} current ${l.h1.replace(/ Jobs$/, "").toLowerCase()} jobs from ${nCo.toLocaleString()} companies, updated daily. Apply directly on each employer's careers page.`.slice(0, 160);
  const ld = { "@context": "https://schema.org", "@graph": [
    { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Job Finder", item: ORIGIN + "/" }, { "@type": "ListItem", position: 2, name: l.h1, item: url }] },
    { "@type": "ItemList", name: l.h1, numberOfItems: list.length, itemListElement: list.slice(0, 20).map((j, i) => ({ "@type": "ListItem", position: i + 1, name: `${j.title} at ${j.company}`, url: j.url })) },
  ] };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(l.title)} | Job Finder</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">${count < 10 ? '<meta name="robots" content="noindex,follow">' : ""}
<meta property="og:title" content="${esc(l.title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:url" content="${url}"><meta property="og:image" content="${ORIGIN}/icon-512.png">
<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<style>:root{--bg:#fafaf8;--card:#fff;--ink:#1d1d1b;--muted:#6b6b66;--line:#e6e5df;--link:#0f566f;--accent:#f96b4c;--pay:#0b7a4b}@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--ink:#ecebe6;--muted:#9a9990;--line:#2f2f2b;--link:#7cc4dc;--pay:#4cc38a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}a{color:var(--link)}
.w{max-width:960px;margin:0 auto;padding:18px 16px 50px}.logo img{height:44px;width:auto;display:block}.crumb{color:var(--muted);font-size:13px;margin:14px 0 4px}.crumb a{color:var(--muted)}
h1{font-size:30px;line-height:1.2;margin:4px 0 10px}h2{font-size:17px;margin:26px 0 10px}.stats{display:flex;flex-wrap:wrap;gap:10px 22px;margin:14px 0}.stats span{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 14px}
.note{color:var(--muted)}.cta{display:inline-block;background:var(--accent);color:#1d1d1b;font-weight:700;text-decoration:none;border-radius:10px;padding:10px 18px;margin:8px 0}
ul.jobs{list-style:none;margin:0;padding:0}.jobs li{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:0 0 8px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.jobs li>a{flex:1;min-width:0;padding:12px 14px;text-decoration:none;color:inherit;display:block}.jobs .t{display:block;font-weight:600;color:var(--link)}.jobs .c{display:block;color:var(--muted);font-size:13px;margin-top:2px}.jobs .d{color:var(--muted);font-size:12px;padding:12px 14px;white-space:nowrap}.pay{color:var(--pay)}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.box{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px}.box h3{margin:0 0 6px;font-size:14px}.box ul{list-style:none;margin:0;padding:0}.box li{display:flex;justify-content:space-between;padding:3px 0;border-top:1px solid var(--line)}.box li:first-child{border:0}.box li span{color:var(--muted)}
.rel{display:flex;flex-wrap:wrap;gap:8px}.rel a{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:6px 14px;text-decoration:none}
footer{margin-top:34px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:13px;display:flex;gap:16px;flex-wrap:wrap}footer a{color:var(--muted)}
@media (max-width:560px){h1{font-size:24px}.jobs li{flex-direction:column;gap:0}.jobs .d{padding:0 14px 10px}}</style></head>
<body><div class="w"><a class="logo" href="/" aria-label="Job Finder home"><img src="/logo.png" alt="Job Finder" width="140" height="44"></a>
<nav class="crumb"><a href="/">Job Finder</a> › ${esc(l.h1)}</nav>
<h1>${esc(l.h1)}</h1>
${l.intro.map(p => `<p>${esc(p)}</p>`).join("")}
<div class="stats">${stats.map(s => `<span>${s}</span>`).join("")}</div>${payLine}
<a class="cta" href="/?q=${encodeURIComponent(l.query)}">Search and filter all ${count.toLocaleString()} roles →</a>
<h2>Latest ${esc(l.h1.replace(/ Jobs$/, ""))} jobs</h2>
${rows ? `<ul class="jobs">${rows}</ul>` : "<p>No current openings found. Check back tomorrow.</p>"}
${count > list.length ? `<p><a class="cta" href="/?q=${encodeURIComponent(l.query)}">See all ${count.toLocaleString()} roles with filters →</a></p>` : ""}
<div class="cols"><div class="box"><h3>Top hiring companies</h3><ul>${topCo}</ul></div><div class="box"><h3>Top locations</h3><ul>${topLoc || "<li>Remote and multiple locations</li>"}</ul></div></div>
<h2>Related searches</h2><div class="rel">${rel}<a href="/">All jobs</a></div>
<footer><span>&copy; 2026 Jobfinder.fyi</span><span>Jobs updated daily · data as of ${esc(asOf.slice(0, 10))}</span><a href="/">Search all jobs</a><a href="/privacy.html">Privacy</a></footer></div></body></html>`;
  return { html, count };
}
