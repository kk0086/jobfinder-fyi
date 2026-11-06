// Shared by signup.html and login.html: email-code flow against /api/auth/*.
(function () {
  const $ = id => document.getElementById(id);
  const api = (p, body) => fetch("/api/auth/" + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async r => ({ ok: r.ok, status: r.status, d: await r.json().catch(() => ({})) }));
  const next = (() => { try { const n = new URLSearchParams(location.search).get("next") || "/"; return n.startsWith("/") && !n.startsWith("//") ? n : "/"; } catch { return "/"; } })();

  // Multi-select dropdown: <div class="ms" data-name data-ph> + options array. Returns { get() }.
  window.makeMulti = function (root, options, placeholder) {
    let sel = [];
    root.innerHTML = '<button type="button" aria-haspopup="listbox" aria-expanded="false"><span class="v"></span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg></button><div class="pn" role="listbox"></div>';
    const btn = root.querySelector("button"), v = root.querySelector(".v"), pn = root.querySelector(".pn");
    options.forEach(o => { const l = document.createElement("label"), c = document.createElement("input"); c.type = "checkbox"; c.value = o; c.onchange = () => { sel = [...pn.querySelectorAll("input:checked")].map(x => x.value); paint(); }; l.append(c, document.createTextNode(o)); pn.append(l); });
    const paint = () => { v.innerHTML = ""; if (!sel.length) { v.innerHTML = '<span class="ph"></span>'; v.firstChild.textContent = placeholder; return; } sel.slice(0, 2).forEach(s => { const c = document.createElement("span"); c.className = "chip"; c.textContent = s; v.append(c); }); if (sel.length > 2) { const c = document.createElement("span"); c.className = "chip"; c.textContent = "+" + (sel.length - 2); v.append(c); } };
    btn.onclick = () => { const o = root.classList.toggle("open"); btn.setAttribute("aria-expanded", o); };
    document.addEventListener("click", e => { if (!root.contains(e.target)) { root.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); } });
    paint();
    return { get: () => sel };
  };

  // Six-box code entry: auto-advance, paste, backspace.
  window.makeCode = function (root) {
    root.innerHTML = Array.from({ length: 6 }, (_, i) => `<input inputmode="numeric" autocomplete="${i ? "off" : "one-time-code"}" maxlength="1" aria-label="Digit ${i + 1}">`).join("");
    const ins = [...root.querySelectorAll("input")];
    ins.forEach((el, i) => {
      el.oninput = () => { el.value = el.value.replace(/\D/g, "").slice(-1); if (el.value && ins[i + 1]) ins[i + 1].focus(); };
      el.onkeydown = e => { if (e.key === "Backspace" && !el.value && ins[i - 1]) ins[i - 1].focus(); };
      el.onpaste = e => { const t = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6); if (!t) return; e.preventDefault(); t.split("").forEach((c, k) => { if (ins[k]) ins[k].value = c; }); (ins[Math.min(t.length, 5)]).focus(); };
    });
    return { get: () => ins.map(x => x.value).join(""), focus: () => ins[0].focus() };
  };

  // mode: "signup" | "login". collect(): returns the fields to send, or an error string.
  window.authFlow = function (mode, collect) {
    const code = makeCode($("code"));
    const err = m => { $("err").textContent = m || ""; $("err2").textContent = m || ""; };
    let email = "";
    $("form").onsubmit = async e => {
      e.preventDefault(); err("");
      const f = collect(); if (typeof f === "string") return err(f);
      email = f.email; const b = $("go"); b.disabled = true;
      const r = await api("start", { mode, ...f }); b.disabled = false;
      if (!r.ok) return err(r.d.error || "Something went wrong. Please try again.");
      $("sentto").textContent = email; $("step1").hidden = true; $("step2").hidden = false; code.focus();
    };
    $("verify").onclick = async () => {
      err(""); const c = code.get(); if (c.length !== 6) return err("Enter the 6-digit code.");
      const b = $("verify"); b.disabled = true; const r = await api("verify", { email, code: c }); b.disabled = false;
      if (!r.ok) return err(r.d.error || "Something went wrong. Please try again.");
      location.href = next;
    };
    $("resend").onclick = async e => { e.preventDefault(); err(""); const f = collect(); const r = await api("start", { mode, ...(typeof f === "string" ? { email } : f) }); err(r.ok ? "" : (r.d.error || "Could not resend.")); if (r.ok) $("resend").textContent = "Code sent. Resend again"; };
    $("change").onclick = e => { e.preventDefault(); err(""); $("step2").hidden = true; $("step1").hidden = false; };
  };
})();
