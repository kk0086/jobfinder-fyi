// Runs automatically for every Netlify Forms submission. Emails the contact form to support@jobfinder.fyi through Resend.
// Needs the RESEND_API_KEY environment variable and a verified jobfinder.fyi domain in Resend. Without the key it does nothing
// (the submission is still saved in Netlify Forms and the Netlify email notification still fires).
const TO = "support@jobfinder.fyi";
const FROM = "Job Finder <forms@jobfinder.fyi>";
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export const handler = async (event: { body?: string | null }) => {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log("submission-created: RESEND_API_KEY missing, skipped"); return { statusCode: 200, body: "no RESEND_API_KEY; skipped" }; }
  let data: Record<string, string> = {};
  try { data = JSON.parse(event.body || "{}")?.payload?.data || {}; } catch {}
  if (!data.message) return { statusCode: 200, body: "empty" };
  const name = String(data.name || "").slice(0, 120), email = String(data.email || "").slice(0, 200), message = String(data.message).slice(0, 4000);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM, to: [TO], subject: "Contact Message", reply_to: email || undefined,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
      html: `<p><b>Name:</b> ${esc(name)}<br><b>Email:</b> ${esc(email)}</p><p style="white-space:pre-wrap">${esc(message)}</p>`,
    }),
  });
  console.log(r.ok ? "submission-created: sent to support@" : "submission-created: resend failed " + r.status + " " + (await r.text()).slice(0, 300));
  return { statusCode: 200, body: r.ok ? "sent" : "failed" };
};
