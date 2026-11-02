import type { Config } from "@netlify/functions";
import { isOwner } from "../lib/auth.mts";

// Owner-only: sends one test email through Resend and returns Resend's answer (never the key), to debug the contact form.
export default async (req: Request) => {
  if (!isOwner(req)) return new Response("Unauthorized", { status: 401 });
  const key = process.env.RESEND_API_KEY;
  if (!key) return Response.json({ ok: false, error: "RESEND_API_KEY is not set in this deploy" });
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "Job Finder <forms@jobfinder.fyi>", to: ["support@jobfinder.fyi"], subject: "Contact Message (test)", text: "Test email from the Job Finder contact form setup." }),
  });
  return Response.json({ ok: r.ok, status: r.status, keyLen: key.length, resend: (await r.text()).slice(0, 500) });
};
export const config: Config = { path: "/api/mailtest", method: ["POST"] };
