import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { isOwner } from "../lib/auth.mts";

// Accounts: sign up with an emailed 6-digit code (once) and a password; later logins use email + password.
// A code is also used to reset a forgotten password. Stores (Netlify Blobs): "users", "authcodes", "authsess".
const FROM = "Job Finder <forms@jobfinder.fyi>";
const COOKIE = "jf_session";
const CODE_TTL = 10 * 60_000, KEEP_TTL = 30 * 86_400_000, SHORT_TTL = 24 * 3_600_000, MAX_TRIES = 5, MAX_SENDS_PER_HOUR = 5, MAX_SENDS_PER_IP_HOUR = 20;
const MAX_LOGIN_FAILS = 8, LOCK_MS = 15 * 60_000, MAX_LOGINS_PER_IP_HOUR = 40;
const MIN_PW = 6, MAX_PW = 128;

const FAMILIES = ["Product management", "Software engineering", "Data engineering", "Technical program management", "Program management", "UX design", "Human resources", "Legal", "Financial analyst", "Bizdev", "Marketing", "Operations", "Executive leadership"];
const LEVELS = ["Entry", "Mid-level", "Senior", "Staff / Principal", "Director", "VP and up"];
const SALARY = ["", "Under $100K", "$100K to $150K", "$150K to $200K", "$200K to $300K", "$300K and above"];
const WORKAUTH = ["", "Authorized to work, no sponsorship needed", "Need visa sponsorship", "Prefer not to say"];
const STATUSES = ["Actively looking", "Open to offers", "Just browsing"];

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const hashPw = (pw: string, salt = randomBytes(16).toString("hex")) => ({ salt, hash: scryptSync(pw, salt, 64).toString("hex") });
const checkPw = (pw: string, rec: { salt: string; hash: string }) => same(scryptSync(pw, rec.salt, 64).toString("hex"), rec.hash);
const DUMMY = hashPw("not-a-real-password"); // equalises timing when the email is unknown
const json = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const clean = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const pick = (v: unknown, allowed: string[]) => (Array.isArray(v) ? v : []).map(x => String(x)).filter(x => allowed.includes(x)).filter((x, i, a) => a.indexOf(x) === i);

function readCookie(req: Request, name: string) {
  const m = (req.headers.get("cookie") || "").split(/;\s*/).find(c => c.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
}
// keep = persistent cookie (30 days); otherwise a browser-session cookie.
const setCookie = (token: string, maxAge: number | null) => `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax${maxAge === null ? "" : `; Max-Age=${maxAge}`}`;

async function sendCode(email: string, code: string, kind: "signup" | "reset") {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("email not configured");
  const title = kind === "signup" ? "Finish creating your account" : "Reset your Job Finder password";
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;color:#14282c"><h2 style="margin:0 0 8px">${title}</h2><p style="margin:0 0 16px;color:#4b5f63">Enter this code on jobfinder.fyi. It expires in 10 minutes.</p><p style="font-size:34px;letter-spacing:8px;font-weight:700;margin:0 0 16px">${esc(code)}</p><p style="margin:0;color:#4b5f63;font-size:13px">If you didn't request this, you can ignore this email.</p></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [email], subject: `Your Job Finder code: ${code}`, html, text: `Your Job Finder code is ${code}. It expires in 10 minutes.` }),
  });
  if (!r.ok) { console.log("auth: resend failed", r.status, (await r.text()).slice(0, 200)); throw new Error("could not send email"); }
}

export default async (req: Request, context: Context) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const action = path.split("/").pop();
  // Strong consistency: a code, account or session must be readable right after it is written (eventual reads can miss it).
  const store = (name: string) => getStore({ name, consistency: "strong" });
  const users = store("users"), codes = store("authcodes"), sess = store("authsess"), ujobs = store("userjobs");
  const ip = sha(String(context.ip || req.headers.get("x-nf-client-connection-ip") || "?"));
  const hour = Math.floor(Date.now() / 3_600_000);

  const startSession = async (uid: string, keep: boolean) => {
    const token = randomBytes(32).toString("base64url"), ttl = keep ? KEEP_TTL : SHORT_TTL;
    await sess.setJSON("t/" + sha(token), { uid, exp: Date.now() + ttl });
    return setCookie(token, keep ? KEEP_TTL / 1000 : null);
  };

  // Owner-only: list members (for ads/exports). Password hashes are never included.
  if (action === "users" && req.method === "GET") {
    if (!isOwner(req)) return new Response("Unauthorized", { status: 401 });
    const out: any[] = [];
    const { blobs } = await users.list({ prefix: "u/" });
    for (let i = 0; i < blobs.length; i += 50) out.push(...(await Promise.all(blobs.slice(i, i + 50).map(b => users.get(b.key, { type: "json" })))).filter(Boolean).map((u: any) => { const { pw, ...rest } = u; return rest; }));
    return json({ count: out.length, users: out });
  }

  if (action === "me" && req.method === "GET") {
    const tok = readCookie(req, COOKIE);
    if (!tok) return json({ user: null });
    const s: any = await sess.get("t/" + sha(tok), { type: "json" });
    if (!s || s.exp < Date.now()) return json({ user: null });
    const u: any = await users.get("u/" + s.uid, { type: "json" });
    if (!u) return json({ user: null });
    const jl: any = (await ujobs.get(s.uid, { type: "json" })) || {};
    return json({ user: { firstName: u.firstName, lastName: u.lastName || "", email: u.email, createdAt: u.createdAt, jobTitle: u.jobTitle || "", currentCompany: u.currentCompany || "", previousCompany: u.previousCompany || "", salaryMin: u.salaryMin || "", workAuth: u.workAuth || "" },
      saved: (jl.saved || []).map((j: any) => j.url), applied: (jl.applied || []).map((j: any) => j.url) });
  }

  // ---- Signed-in member actions: profile details, saved jobs, applied jobs ----
  if (action === "jobs" || action === "job" || action === "profile") {
    const tok = readCookie(req, COOKIE);
    const s: any = tok ? await sess.get("t/" + sha(tok), { type: "json" }) : null;
    if (!s || s.exp < Date.now()) return json({ error: "Please log in." }, 401);
    const uidm: string = s.uid;
    if (action === "jobs" && req.method === "GET") {
      const jl: any = (await ujobs.get(uidm, { type: "json" })) || {};
      return json({ saved: jl.saved || [], applied: jl.applied || [] });
    }
    if (req.method !== "POST") return json({ error: "Not found" }, 404);
    let q: any;
    try { q = JSON.parse(await req.text()); } catch { return json({ error: "Bad request" }, 400); }
    if (action === "profile") {
      const u: any = await users.get("u/" + uidm, { type: "json" });
      if (!u) return json({ error: "Please log in." }, 401);
      u.jobTitle = clean(q.jobTitle, 80); u.currentCompany = clean(q.currentCompany, 80); u.previousCompany = clean(q.previousCompany, 80);
      u.salaryMin = SALARY.includes(q.salaryMin) ? q.salaryMin : ""; u.workAuth = WORKAUTH.includes(q.workAuth) ? q.workAuth : "";
      await users.setJSON("u/" + uidm, u);
      return json({ ok: true });
    }
    const j = q.job || {}, url = clean(j.url, 600);
    if (!/^https?:\/\//i.test(url)) return json({ error: "Bad job." }, 400);
    const MAXJ = 500;
    const jl: any = (await ujobs.get(uidm, { type: "json" })) || {};
    jl.saved = jl.saved || []; jl.applied = jl.applied || [];
    const rec = { url, title: clean(j.title, 160), company: clean(j.company, 100), location: clean(j.location, 160), department: clean(j.department, 80), at: new Date().toISOString() };
    const has = (l: any[]) => l.some(x => x.url === url);
    const drop = (l: any[]) => l.filter(x => x.url !== url);
    const op = q.op;
    if (op === "save" && !has(jl.saved)) { if (jl.saved.length >= MAXJ) return json({ error: "You've reached the limit of 500 saved jobs." }, 400); jl.saved.unshift(rec); }
    else if (op === "unsave") jl.saved = drop(jl.saved);
    else if (op === "apply" && !has(jl.applied)) { if (jl.applied.length >= MAXJ) return json({ error: "You've reached the limit of 500 applied jobs." }, 400); jl.applied.unshift(rec); }
    else if (op === "unapply") jl.applied = drop(jl.applied);
    else if (op === "flag") {
      const FL = ["interview", "offer", "accepted"], f = String(q.flag), item = jl.applied.find((x: any) => x.url === url);
      if (!FL.includes(f) || !item) return json({ error: "Bad request" }, 400);
      item[f] = !!q.value;
      if (f === "accepted" && item.accepted) item.offer = true; // accepting implies an offer
      if (f === "offer" && !item.offer) item.accepted = false;
    }
    else if (!["save", "unsave", "apply", "unapply", "flag"].includes(op)) return json({ error: "Bad request" }, 400);
    await ujobs.setJSON(uidm, jl);
    return json({ ok: true, saved: jl.saved.length, applied: jl.applied.length });
  }

  if (action === "logout" && req.method === "POST") {
    const tok = readCookie(req, COOKIE);
    if (tok) await sess.delete("t/" + sha(tok)).catch(() => {});
    return json({ ok: true }, 200, { "set-cookie": setCookie("", 0) });
  }

  if (req.method !== "POST") return json({ error: "Not found" }, 404);
  let b: any;
  try { b = JSON.parse(await req.text()); } catch { return json({ error: "Bad request" }, 400); }
  const email = clean(b?.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  const uid = sha(email);
  const goodPw = (p: unknown) => typeof p === "string" && p.length >= MIN_PW && p.length <= MAX_PW;

  // Rate-limited code email (sign up / password reset).
  const issueCode = async (kind: "signup" | "reset", extra: Record<string, unknown>) => {
    const now = Date.now();
    const ipKey = "ip/" + ip + "/" + hour, ipN = Number(await codes.get(ipKey) || 0);
    if (ipN >= MAX_SENDS_PER_IP_HOUR) return json({ error: "Too many requests. Try again later." }, 429);
    const prev: any = await codes.get("c/" + uid, { type: "json" });
    const sends = ((prev?.sends as number[]) || []).filter(t => now - t < 3_600_000);
    if (sends.length >= MAX_SENDS_PER_HOUR) return json({ error: "Too many codes requested. Try again in a bit." }, 429);
    await codes.set(ipKey, String(ipN + 1));
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0"), salt = randomBytes(8).toString("hex");
    await codes.setJSON("c/" + uid, { kind, salt, hash: sha(salt + code), exp: now + CODE_TTL, tries: 0, sends: [...sends, now], ...extra });
    try { await sendCode(email, code, kind); } catch { return json({ error: "We couldn't send the email right now. Please try again." }, 502); }
    return null;
  };
  // Checks a submitted code; returns the record on success, or an error Response.
  const checkCode = async (kind: "signup" | "reset", code: string) => {
    const rec: any = await codes.get("c/" + uid, { type: "json" });
    if (!rec || rec.kind !== kind || rec.exp < Date.now() || rec.tries >= MAX_TRIES) return json({ error: "That code is invalid or has expired. Request a new one." }, 400);
    if (!/^\d{6}$/.test(code) || !same(sha(rec.salt + code), rec.hash)) {
      rec.tries++; await codes.setJSON("c/" + uid, rec);
      return json({ error: rec.tries >= MAX_TRIES ? "Too many attempts. Request a new code." : "That code isn't right. Check it and try again." }, 400);
    }
    return rec;
  };

  // ---- Sign up: validate, email a one-time code ----
  if (action === "start") {
    const firstName = clean(b.firstName, 60), country = clean(b.country, 2).toUpperCase(), zip = clean(b.zip, 12);
    if (!firstName) return json({ error: "Enter your first name." }, 400);
    if (!goodPw(b.password)) return json({ error: `Choose a password of at least ${MIN_PW} characters.` }, 400);
    if (!/^[A-Z]{2}$/.test(country)) return json({ error: "Choose your country." }, 400);
    if (zip && !/^[A-Za-z0-9 -]{3,12}$/.test(zip)) return json({ error: "Enter a valid ZIP / postal code." }, 400);
    if (!b.agreePrivacy) return json({ error: "Please agree to the Privacy policy." }, 400);
    if (await users.get("u/" + uid)) return json({ error: "An account with this email already exists. Log in instead." }, 409);
    const profile = {
      firstName, lastName: clean(b.lastName, 60), country, zip,
      jobFamilies: pick(b.jobFamilies, FAMILIES), seniority: pick(b.seniority, LEVELS), searchStatus: STATUSES.includes(b.searchStatus) ? b.searchStatus : "",
      marketingOptIn: !!b.marketingOptIn,
    };
    const err = await issueCode("signup", { profile, pw: hashPw(b.password) });
    return err || json({ ok: true });
  }

  // ---- Sign up: confirm the code, create the account, sign in ----
  if (action === "verify") {
    const rec = await checkCode("signup", clean(b.code, 6));
    if (rec instanceof Response) return rec;
    if (await users.get("u/" + uid)) return json({ error: "An account with this email already exists. Log in instead." }, 409);
    await codes.delete("c/" + uid);
    const now = new Date().toISOString(), g: any = context.geo || {};
    const user = { id: uid, email, ...rec.profile, pw: rec.pw, termsAcceptedAt: now, createdAt: now, signupGeo: { country: g.country?.code || "", city: clean(g.city, 60), region: clean(g.subdivision?.code || g.subdivision?.name, 40) }, lastLoginAt: now };
    await users.setJSON("u/" + uid, user);
    return json({ ok: true, user: { firstName: user.firstName, email } }, 200, { "set-cookie": await startSession(uid, true) });
  }

  // ---- Login: email + password (no code) ----
  if (action === "login") {
    const now = Date.now(), ipKey = "li/" + ip + "/" + hour, ipN = Number(await codes.get(ipKey) || 0);
    if (ipN >= MAX_LOGINS_PER_IP_HOUR) return json({ error: "Too many attempts. Try again later." }, 429);
    const lk: any = (await codes.get("lf/" + uid, { type: "json" })) || { n: 0, until: 0 };
    if (lk.until > now) return json({ error: "Too many failed attempts. Try again in a few minutes, or reset your password." }, 429);
    await codes.set(ipKey, String(ipN + 1));
    const user: any = await users.get("u/" + uid, { type: "json" });
    const pwOk = typeof b.password === "string" && b.password.length <= MAX_PW && checkPw(b.password, user?.pw || DUMMY);
    if (!user || !user.pw || !pwOk) {
      lk.n = (lk.n || 0) + 1; if (lk.n >= MAX_LOGIN_FAILS) { lk.until = now + LOCK_MS; lk.n = 0; }
      await codes.setJSON("lf/" + uid, lk);
      return json({ error: "Incorrect email or password." }, 401);
    }
    await codes.delete("lf/" + uid).catch(() => {});
    user.lastLoginAt = new Date(now).toISOString(); await users.setJSON("u/" + uid, user);
    return json({ ok: true, user: { firstName: user.firstName, email } }, 200, { "set-cookie": await startSession(uid, !!b.keep) });
  }

  // ---- Forgot password: emailed code, then a new password ----
  if (action === "reset-start") {
    const user = await users.get("u/" + uid);
    if (!user) { await codes.set("ip/" + ip + "/" + hour, String(Number(await codes.get("ip/" + ip + "/" + hour) || 0) + 1)); return json({ ok: true }); } // same answer either way
    const err = await issueCode("reset", {});
    return err || json({ ok: true });
  }
  if (action === "reset") {
    if (!goodPw(b.password)) return json({ error: `Choose a password of at least ${MIN_PW} characters.` }, 400);
    const rec = await checkCode("reset", clean(b.code, 6));
    if (rec instanceof Response) return rec;
    const user: any = await users.get("u/" + uid, { type: "json" });
    if (!user) return json({ error: "That code is invalid or has expired. Request a new one." }, 400);
    await codes.delete("c/" + uid); await codes.delete("lf/" + uid).catch(() => {});
    user.pw = hashPw(b.password); user.lastLoginAt = new Date().toISOString(); await users.setJSON("u/" + uid, user);
    return json({ ok: true, user: { firstName: user.firstName, email } }, 200, { "set-cookie": await startSession(uid, true) });
  }

  return json({ error: "Not found" }, 404);
};

export const config: Config = { path: "/api/auth/*" };
