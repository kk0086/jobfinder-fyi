import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { isOwner } from "../lib/auth.mts";

// Passwordless accounts: sign up or log in with a 6-digit code emailed through Resend.
// Stores (Netlify Blobs): "users" (profiles), "authcodes" (hashed one-time codes), "authsess" (hashed session tokens).
const FROM = "Job Finder <forms@jobfinder.fyi>";
const COOKIE = "jf_session";
const CODE_TTL = 10 * 60_000, SESSION_TTL = 30 * 86_400_000, MAX_TRIES = 5, MAX_SENDS_PER_HOUR = 5, MAX_SENDS_PER_IP_HOUR = 20;

const FAMILIES = ["Product management", "Software engineering", "Data engineering", "Technical program management", "Program management", "UX design", "Human resources", "Legal", "Financial analyst", "Bizdev", "Marketing", "Operations", "Executive leadership"];
const LEVELS = ["Entry", "Mid-level", "Senior", "Staff / Principal", "Director", "VP and up"];
const STATUSES = ["Actively looking", "Open to offers", "Just browsing"];

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const json = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const clean = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const pick = (v: unknown, allowed: string[]) => (Array.isArray(v) ? v : []).map(x => String(x)).filter(x => allowed.includes(x)).filter((x, i, a) => a.indexOf(x) === i);

function readCookie(req: Request, name: string) {
  const m = (req.headers.get("cookie") || "").split(/;\s*/).find(c => c.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
}
const setCookie = (token: string, maxAge: number) => `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function sendCode(email: string, code: string, signup: boolean) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("email not configured");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;color:#14282c"><h2 style="margin:0 0 8px">${signup ? "Finish creating your account" : "Log in to Job Finder"}</h2><p style="margin:0 0 16px;color:#4b5f63">Enter this code on jobfinder.fyi. It expires in 10 minutes.</p><p style="font-size:34px;letter-spacing:8px;font-weight:700;margin:0 0 16px">${esc(code)}</p><p style="margin:0;color:#4b5f63;font-size:13px">If you didn't request this, you can ignore this email.</p></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [email], subject: `Your Job Finder code: ${code}`, html, text: `Your Job Finder code is ${code}. It expires in 10 minutes.` }),
  });
  if (!r.ok) { console.log("auth: resend failed", r.status, (await r.text()).slice(0, 200)); throw new Error("could not send email"); }
}

export default async (req: Request, context: Context) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const action = path.split("/").pop();
  const users = getStore("users"), codes = getStore("authcodes"), sess = getStore("authsess");

  // Owner-only: list members (for ads/exports).
  if (action === "users" && req.method === "GET") {
    if (!isOwner(req)) return new Response("Unauthorized", { status: 401 });
    const out: any[] = [];
    const { blobs } = await users.list({ prefix: "u/" });
    for (let i = 0; i < blobs.length; i += 50) out.push(...(await Promise.all(blobs.slice(i, i + 50).map(b => users.get(b.key, { type: "json" })))).filter(Boolean));
    return json({ count: out.length, users: out });
  }

  if (action === "me" && req.method === "GET") {
    const tok = readCookie(req, COOKIE);
    if (!tok) return json({ user: null });
    const s: any = await sess.get("t/" + sha(tok), { type: "json" });
    if (!s || s.exp < Date.now()) return json({ user: null });
    const u: any = await users.get("u/" + s.uid, { type: "json" });
    return json({ user: u ? { firstName: u.firstName, email: u.email } : null });
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

  if (action === "start") {
    const signup = b.mode === "signup";
    let profile: any = null;
    if (signup) {
      const firstName = clean(b.firstName, 60);
      const country = clean(b.country, 2).toUpperCase();
      const zip = clean(b.zip, 12);
      if (!firstName) return json({ error: "Enter your first name." }, 400);
      if (!/^[A-Z]{2}$/.test(country)) return json({ error: "Choose your country." }, 400);
      if (zip && !/^[A-Za-z0-9 -]{3,12}$/.test(zip)) return json({ error: "Enter a valid ZIP / postal code." }, 400);
      if (!b.agreePrivacy) return json({ error: "Please agree to the Privacy policy." }, 400);
      const status = STATUSES.includes(b.searchStatus) ? b.searchStatus : "";
      profile = {
        firstName, lastName: clean(b.lastName, 60), country, zip,
        jobFamilies: pick(b.jobFamilies, FAMILIES), seniority: pick(b.seniority, LEVELS), searchStatus: status,
        marketingOptIn: !!b.marketingOptIn,
      };
    }
    // Rate limits: per email and per IP, per hour.
    const now = Date.now(), hour = Math.floor(now / 3_600_000);
    const ipKey = "ip/" + sha(String(context.ip || req.headers.get("x-nf-client-connection-ip") || "?")) + "/" + hour;
    const ipN = Number(await codes.get(ipKey) || 0);
    if (ipN >= MAX_SENDS_PER_IP_HOUR) return json({ error: "Too many requests. Try again later." }, 429);
    const prev: any = await codes.get("c/" + uid, { type: "json" });
    const sends = ((prev?.sends as number[]) || []).filter(t => now - t < 3_600_000);
    if (sends.length >= MAX_SENDS_PER_HOUR) return json({ error: "Too many codes requested. Try again in a bit." }, 429);
    await codes.set(ipKey, String(ipN + 1));

    const existing = await users.get("u/" + uid, { type: "json" });
    // Log in for an unknown email: say nothing different (no account enumeration), just don't send.
    if (!signup && !existing) return json({ ok: true });

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const salt = randomBytes(8).toString("hex");
    await codes.setJSON("c/" + uid, { salt, hash: sha(salt + code), exp: now + CODE_TTL, tries: 0, signup: signup && !existing, profile: signup && !existing ? profile : null, sends: [...sends, now] });
    try { await sendCode(email, code, signup && !existing); } catch (e: any) { return json({ error: "We couldn't send the email right now. Please try again." }, 502); }
    return json({ ok: true });
  }

  if (action === "verify") {
    const code = clean(b.code, 6);
    const rec: any = await codes.get("c/" + uid, { type: "json" });
    if (!rec || rec.exp < Date.now() || rec.tries >= MAX_TRIES) { return json({ error: "That code is invalid or has expired. Request a new one." }, 400); }
    if (!/^\d{6}$/.test(code) || !same(sha(rec.salt + code), rec.hash)) {
      rec.tries++; await codes.setJSON("c/" + uid, rec);
      return json({ error: rec.tries >= MAX_TRIES ? "Too many attempts. Request a new code." : "That code isn't right. Check it and try again." }, 400);
    }
    await codes.delete("c/" + uid);
    const now = Date.now();
    let user: any = await users.get("u/" + uid, { type: "json" });
    if (!user && rec.signup && rec.profile) {
      const g: any = context.geo || {};
      user = { id: uid, email, ...rec.profile, termsAcceptedAt: new Date(now).toISOString(), createdAt: new Date(now).toISOString(), signupGeo: { country: g.country?.code || "", city: clean(g.city, 60), region: clean(g.subdivision?.code || g.subdivision?.name, 40) }, lastLoginAt: new Date(now).toISOString() };
    } else if (user) { user.lastLoginAt = new Date(now).toISOString(); }
    else return json({ error: "That code is invalid or has expired. Request a new one." }, 400);
    await users.setJSON("u/" + uid, user);
    const token = randomBytes(32).toString("base64url");
    await sess.setJSON("t/" + sha(token), { uid, exp: now + SESSION_TTL });
    return json({ ok: true, user: { firstName: user.firstName, email: user.email }, created: !!rec.signup }, 200, { "set-cookie": setCookie(token, SESSION_TTL / 1000) });
  }

  return json({ error: "Not found" }, 404);
};

export const config: Config = { path: "/api/auth/*" };
