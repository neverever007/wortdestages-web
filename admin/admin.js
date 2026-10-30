// Admin-Dashboard für „Wort des Tages“ und „Zitat des Tages“.
// Anmeldung direkt bei den beiden Supabase-Projekten; was erlaubt ist, prüft allein die Datenbank (is_admin).
(() => {
  "use strict";

  const CFG = window.WDT_CONFIG;
  const PROJECTS = {
    zitat: { ...CFG.zitat, name: "Zitat des Tages", color: "#e07a8c" },
    wort: { ...CFG.wort, name: "Wort des Tages", color: "#22d3d8" },
  };
  // Feste Reihenfolge für Diagramme mit mehreren Linien (Referenzpalette, dunkle Stufen)
  const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"];

  const MONTHS = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."];
  const MONTHS_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const LEVELS = { wortneuling: "Wortneuling", wortsucher: "Wortsucher", wortkenner: "Wortkenner", wortmeister: "Wortmeister", wortlegende: "Wortlegende" };

  // ---------------------------------------------------------------- Hilfen

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => (n === null || n === undefined ? "–" : Number(n).toLocaleString("de-DE"));
  const pct = (n) => (n === null || n === undefined ? "–" : `${fmt(n)} %`);
  const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  const parse = (iso) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const shiftIso = (iso, days) => { const t = parse(iso); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10); };
  const shortDay = (iso) => { const t = parse(iso); return `${t.getUTCDate()}. ${MONTHS[t.getUTCMonth()]}`; };
  const wdDay = (iso) => { const t = parse(iso); return `${WD[t.getUTCDay()]} ${t.getUTCDate()}.${t.getUTCMonth() + 1}.`; };
  const longDay = (iso) => { const t = parse(iso); return `${WD_LONG[t.getUTCDay()]}, ${t.getUTCDate()}. ${MONTHS_LONG[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };
  const dateTime = (ts) => ts ? new Date(ts).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }) : "–";
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

  function toast(msg, isError = false) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("err", isError);
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), isError ? 5000 : 2600);
  }

  // ---------------------------------------------------------------- Anmeldung & Datenzugriff

  const storeKey = (p) => `wdt-admin-${p}`;
  const sessions = {};
  for (const p of Object.keys(PROJECTS)) {
    try { sessions[p] = JSON.parse(sessionStorage.getItem(storeKey(p))) || null; } catch { sessions[p] = null; }
  }
  function saveSession(p, s) {
    sessions[p] = s;
    try { s ? sessionStorage.setItem(storeKey(p), JSON.stringify(s)) : sessionStorage.removeItem(storeKey(p)); } catch { /* ohne Speicher nur für diese Seite angemeldet */ }
  }
  const loggedIn = (p) => !!sessions[p];

  async function authCall(p, grant, body) {
    const res = await fetch(`${PROJECTS[p].url}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: { apikey: PROJECTS[p].key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = j.error_description || j.msg || j.message || `Fehler ${res.status}`;
      throw new Error(/invalid login/i.test(msg) ? "E-Mail oder Passwort falsch" : msg);
    }
    saveSession(p, {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
      email: j.user?.email,
    });
  }

  async function accessToken(p) {
    const s = sessions[p];
    if (!s) throw new Error("Nicht angemeldet");
    if (s.expires_at * 1000 - Date.now() < 60_000) {
      try {
        await authCall(p, "refresh_token", { refresh_token: s.refresh_token });
      } catch {
        saveSession(p, null);
        throw new Error("Sitzung abgelaufen – bitte neu anmelden");
      }
    }
    return sessions[p].access_token;
  }

  async function api(p, path, { method = "GET", body, prefer } = {}) {
    const headers = { apikey: PROJECTS[p].key, Authorization: `Bearer ${await accessToken(p)}`, "Content-Type": "application/json" };
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${PROJECTS[p].url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (!res.ok) throw new Error((data && (data.message || data.hint)) || `Fehler ${res.status}`);
    return data;
  }
  const rpc = (p, fn, args = {}) => api(p, `rpc/${fn}`, { method: "POST", body: args });

  // ---------------------------------------------------------------- Statistiken (zwischengespeichert)

  const stats = { zitat: null, wort: null };
  const statsError = { zitat: null, wort: null };

  async function loadStats(p, force = false) {
    if (!loggedIn(p)) return null;
    if (stats[p] && !force) return stats[p];
    try {
      stats[p] = await rpc(p, "admin_stats");
      statsError[p] = null;
    } catch (e) {
      statsError[p] = /admin_stats/.test(e.message) && /find|exist/i.test(e.message)
        ? "Die Statistik-Funktion fehlt noch – bitte das SQL in Supabase ausführen."
        : e.message;
      stats[p] = null;
    }
    updateBadges();
    return stats[p];
  }

  function updateBadges() {
    const set = (key, n) => { const el = document.querySelector(`[data-badge="${key}"]`); if (el) el.textContent = n ? String(n) : ""; };
    set("zitat-suggestions", stats.zitat?.open?.suggestions);
    set("zitat-reports", stats.zitat?.open?.reports);
    set("zitat-ideas", stats.zitat?.open?.ideas);
    set("wort-suggestions", stats.wort?.open?.suggestions);
    set("wort-ideas", stats.wort?.open?.ideas);
  }

  // ---------------------------------------------------------------- Diagramme

  let charts = [];
  function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }

  if (window.Chart) {
    Chart.defaults.color = "#a1a1aa";
    Chart.defaults.borderColor = "#26262a";
    Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.plugins.tooltip.backgroundColor = "#232327";
    Chart.defaults.plugins.tooltip.borderColor = "#3a3a40";
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.titleColor = "#f4f4f5";
    Chart.defaults.plugins.tooltip.bodyColor = "#d4d4d8";
    Chart.defaults.plugins.tooltip.boxPadding = 4;
  }

  const baseScales = () => ({
    x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 }, border: { color: "#3a3a40" } },
    y: { beginAtZero: true, grid: { color: "#222226" }, ticks: { precision: 0 }, border: { display: false } },
  });

  function lineChart(id, labels, series) {
    const el = document.getElementById(id);
    if (!el || !window.Chart) return;
    charts.push(new Chart(el, {
      type: "line",
      data: {
        labels,
        datasets: series.map((s) => ({
          label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.color,
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHoverBorderWidth: 2,
          pointHoverBorderColor: "#151517", tension: 0.25, fill: false,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false } },
        scales: baseScales(),
      },
    }));
  }

  function barChart(id, labels, data, color, label = "Anzahl") {
    const el = document.getElementById(id);
    if (!el || !window.Chart) return;
    charts.push(new Chart(el, {
      type: "bar",
      data: {
        labels,
        datasets: [{ label, data, backgroundColor: color, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 34 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: baseScales(),
      },
    }));
  }

  const legend = (series) => series.length < 2 ? "" :
    `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join("")}</div>`;

  const panel = (id, title, desc = "", wide = false, series = []) => `
    <section class="panel${wide ? " wide" : ""}">
      <h3>${esc(title)}</h3>${desc ? `<p class="desc">${desc}</p>` : `<div style="height:10px"></div>`}
      ${legend(series)}
      <div class="chart-box"><canvas id="${id}" role="img" aria-label="${esc(title)}"></canvas></div>
    </section>`;

  const tile = (label, value, hint = "", cls = "") =>
    `<div class="tile ${cls}"><div class="label">${esc(label)}</div><div class="value">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;

  function table(cols, rows, empty = "Noch keine Daten.") {
    if (!rows || !rows.length) return `<p class="empty">${empty}</p>`;
    return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.num ? "num" : ""}${c.clip ? " clip" : ""}">${c.html ? c.html(r) : esc(c.get(r))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  // ---------------------------------------------------------------- Dialog mit Formular

  function formDialog({ title, intro = "", fields, submit = "Speichern", danger, onSubmit, onDanger, onOpen }) {
    const dlg = $("#dialog");
    const field = (f) => {
      const common = `name="${f.name}" ${f.required ? "required" : ""} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ""}`;
      const input = f.type === "textarea"
        ? `<textarea ${common}>${esc(f.value)}</textarea>`
        : f.type === "select"
          ? `<select ${common}>${f.options.map((o) => `<option value="${esc(o.value)}"${o.value === f.value ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`
          : `<input type="${f.type || "text"}" ${common} value="${esc(f.value)}" ${f.min !== undefined ? `min="${f.min}"` : ""}>`;
      return `<label>${esc(f.label)}${input}${f.help ? `<span class="small muted" data-help="${f.name}">${f.help}</span>` : ""}</label>`;
    };
    const rows = fields.map((f) => Array.isArray(f) ? `<div class="row">${f.map(field).join("")}</div>` : field(f)).join("");
    dlg.innerHTML = `<form novalidate>
      <h2>${esc(title)}</h2>${intro}
      ${rows}
      <p class="error" data-err></p>
      <div class="buttons">
        ${danger ? `<button type="button" class="btn danger left" data-act="danger">${esc(danger)}</button>` : ""}
        <button type="button" class="btn ghost" data-act="cancel">Abbrechen</button>
        <button type="submit" class="btn primary">${esc(submit)}</button>
      </div></form>`;
    const form = dlg.querySelector("form");
    const err = form.querySelector("[data-err]");
    const busy = (b) => form.querySelectorAll("button").forEach((x) => { x.disabled = b; });
    const run = async (fn) => {
      busy(true);
      err.textContent = "";
      try { await fn(); dlg.close(); } catch (e) { err.textContent = e.message; } finally { busy(false); }
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form));
      for (const k of Object.keys(data)) data[k] = data[k].trim();
      run(() => onSubmit(data));
    });
    form.querySelector("[data-act=cancel]").onclick = () => dlg.close();
    const d = form.querySelector("[data-act=danger]");
    if (d) d.onclick = () => run(onDanger);
    dlg.showModal();
    form.querySelector("input, textarea")?.focus();
    onOpen?.(form);
  }

  const nullIfEmpty = (s) => (s ? s : null);

  // ---------------------------------------------------------------- Seiten

  const view = () => $("#view");
  const head = (title, sub = "", extra = "") =>
    `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div>${extra}</div>`;
  const notLoggedIn = (p) => `${head(PROJECTS[p].name)}<div class="note-box">Für „${esc(PROJECTS[p].name)}“ bist du nicht angemeldet oder hast dort keine Admin-Rechte. <a href="#" data-relogin>Neu anmelden</a></div>`;
  const loading = () => `<p class="loading">Wird geladen …</p>`;

  function planUntil(s) {
    if (!s?.planning) return { text: "–", warn: false };
    const gap = s.planning.first_gap;
    if (!gap) return { text: "über 2 Jahre", warn: false };
    const last = shiftIso(gap, -1);
    const daysLeft = daysBetween(s.today, last);
    return { text: daysLeft <= 0 ? "nichts geplant" : shortDay(last), hint: daysLeft > 0 ? `${daysLeft} Tage im Voraus` : "Lücke ab morgen", warn: daysLeft < 14 };
  }

  // ---------- Übersicht
  async function renderOverview() {
    view().innerHTML = head("Übersicht", longDay(todayIso())) + loading();
    const [z, w] = await Promise.all([loadStats("zitat"), loadStats("wort")]);
    let html = head("Übersicht", longDay(todayIso()));

    for (const [p, s] of [["wort", w], ["zitat", z]]) {
      html += `<h2 class="section-title"><span class="dot ${p}"></span>${esc(PROJECTS[p].name)}</h2>`;
      if (!loggedIn(p)) { html += `<div class="note-box">Nicht angemeldet.</div>`; continue; }
      if (!s) { html += `<div class="note-box">${esc(statsError[p] || "Keine Daten")}</div>`; continue; }
      const open = Object.values(s.open || {}).reduce((a, b) => a + (b || 0), 0);
      const plan = planUntil(s);
      html += `<div class="tiles">
        ${tile("Nutzer gesamt", fmt(s.users_total), `+${fmt(s.new_7)} in 7 Tagen`, `accent-${p}`)}
        ${tile("Aktiv heute", fmt(s.active_today), "mit Konto", `accent-${p}`)}
        ${tile("Aktiv (7 Tage)", fmt(s.active_7), "", `accent-${p}`)}
        ${tile("Aktiv (30 Tage)", fmt(s.active_30), s.active_30 ? `${Math.round((100 * s.active_today) / s.active_30)} % davon heute` : "", `accent-${p}`)}
        ${tile("Offene Aufgaben", fmt(open), "Vorschläge, Meldungen, Ideen", `accent-${p}${open ? " warn" : ""}`)}
        ${tile("Geplant bis", plan.text, plan.hint || "", `accent-${p}${plan.warn ? " warn" : ""}`)}
        <a class="tile accent-${p}" href="#${p}-social" style="text-decoration:none"><div class="label">Social Media heute</div><div class="value" id="soc-${p}">…</div><div class="hint" id="soc-${p}-hint"></div></a>
      </div>`;
    }

    const both = [["wort", w], ["zitat", z]].filter(([, s]) => s && s.daily);
    if (both.length) {
      const labels = both[0][1].daily.map((d) => shortDay(d.day));
      const activeSeries = both.map(([p, s]) => ({ label: PROJECTS[p].name, color: PROJECTS[p].color, data: s.daily.map((d) => d.active) }));
      const signupSeries = both.map(([p, s]) => ({ label: PROJECTS[p].name, color: PROJECTS[p].color, data: s.daily.map((d) => d.signups) }));
      html += `<h2 class="section-title">Verlauf (60 Tage)</h2><div class="charts">
        ${panel("ov-active", "Aktive Nutzer pro Tag", "Nutzer mit Konto, die die App an dem Tag geöffnet haben", true, activeSeries)}
        ${panel("ov-signups", "Neue Registrierungen pro Tag", "", true, signupSeries)}
      </div>`;
      view().innerHTML = html + extrasHtml();
      lineChart("ov-active", labels, activeSeries);
      lineChart("ov-signups", labels, signupSeries);
    } else {
      view().innerHTML = html + extrasHtml();
    }
    loadVideoStatus();
  }

  function extrasHtml() {
    return `<p class="muted small" style="margin-top:10px">Nutzerzahlen zählen Konten; Gäste ohne Konto werden nicht erfasst.</p>`;
  }

  async function loadVideoStatus() {
    for (const p of ["wort", "zitat"]) {
      const el = $(`#soc-${p}`);
      if (!el) continue;
      if (!loggedIn(p)) { el.textContent = "–"; continue; }
      const s = await socialToday(p);
      el.textContent = s.text;
      el.parentElement.classList.toggle("warn", s.warn);
      $(`#soc-${p}-hint`).textContent = s.hint;
    }
  }

  // ---------- Statistik: Zitat
  async function renderZitatStats() {
    const p = "zitat";
    view().innerHTML = head("Zitat des Tages · Statistik") + loading();
    const s = await loadStats(p);
    if (!s) { view().innerHTML = head("Zitat des Tages · Statistik") + `<div class="note-box">${esc(statsError[p])}</div>`; return; }
    const t = s.totals, r = s.retention;
    const labels = s.daily.map((d) => shortDay(d.day));
    const inter = [
      { label: "Favoriten", key: "favorites" }, { label: "Angewendet", key: "applied" }, { label: "Quiz", key: "quiz" },
      { label: "Beiträge", key: "posts" }, { label: "Geteilt", key: "shares" },
    ].map((x, i) => ({ ...x, color: SERIES[i], data: s.daily.map((d) => d[x.key]) }));
    const reactions = Object.entries(s.reactions || {});

    view().innerHTML = head("Zitat des Tages · Statistik", `Stand ${longDay(s.today)} · ${fmt(s.bots)} Bots herausgerechnet`) + `
      <div class="tiles">
        ${tile("Nutzer gesamt", fmt(s.users_total), `+${fmt(s.new_today)} heute`, "accent-zitat")}
        ${tile("Neu (7 / 30 Tage)", `${fmt(s.new_7)} / ${fmt(s.new_30)}`, "", "accent-zitat")}
        ${tile("Aktiv heute", fmt(s.active_today), "", "accent-zitat")}
        ${tile("Aktiv (7 / 30 Tage)", `${fmt(s.active_7)} / ${fmt(s.active_30)}`, "", "accent-zitat")}
        ${tile("Bindung (aktiv heute / 30 Tage)", s.active_30 ? pct(Math.round((100 * s.active_today) / s.active_30)) : "–", "Anteil der Monatsnutzer, die heute da waren", "accent-zitat")}
      </div>
      <h2 class="section-title">Wiederkehr nach der Registrierung</h2>
      <div class="tiles">
        ${tile("Am nächsten Tag", pct(r.d1), `von ${fmt(r.d1_n)} Neuen (letzte 90 Tage)`)}
        ${tile("In Woche 2", pct(r.d7), `von ${fmt(r.d7_n)} Neuen`)}
        ${tile("Nach 30 Tagen", pct(r.d30), `von ${fmt(r.d30_n)} Neuen`)}
      </div>
      <h2 class="section-title">Verlauf (60 Tage)</h2>
      <div class="charts">
        ${panel("z-active", "Aktive Nutzer pro Tag", "", true)}
        ${panel("z-signups", "Neue Registrierungen pro Tag")}
        ${panel("z-weekday", "Aktivität nach Wochentag", "App-Öffnungen der letzten 90 Tage")}
        ${panel("z-inter", "Aktionen pro Tag", "", true, inter)}
        ${panel("z-activedays", "Wie oft kommen Nutzer?", "Aktive Tage pro Nutzer in den letzten 30 Tagen")}
        ${panel("z-quiz", "Quiz-Ergebnisse", "Richtige Antworten pro Runde")}
        ${reactions.length ? panel("z-reactions", "Reaktionen im Feed") : ""}
      </div>
      <h2 class="section-title">Gesamt</h2>
      <div class="tiles">
        ${tile("Zitate in der Datenbank", fmt(t.quotes), `${fmt(s.planning.unused_quotes)} noch nie gezeigt/geplant`)}
        ${tile("Favoriten", fmt(t.favorites))}
        ${tile("Im Alltag angewendet", fmt(t.applied))}
        ${tile("Quiz-Runden", fmt(t.quiz))}
        ${tile("Beiträge im Feed", fmt(t.posts))}
        ${tile("Upvotes / Downvotes", `${fmt(t.votes_up)} / ${fmt(t.votes_down)}`)}
        ${tile("Reaktionen", fmt(t.reactions))}
        ${tile("Geteilt", fmt(t.shares))}
        ${tile("Duelle", fmt(t.duels), `${fmt(t.duels_done)} beendet`)}
        ${tile("Einladungen", fmt(t.invites))}
        ${tile("Freundschaften", fmt(t.friendships))}
        ${tile("Zitat-Vorschläge", fmt(t.suggestions), `${fmt(t.suggestions_accepted)} angenommen`)}
      </div>
      <div class="charts" style="margin-top:14px">
        <section class="panel wide"><h3>Beliebteste Zitate</h3><p class="desc">Nach Favoriten</p>
          ${table([{ label: "Zitat", get: (x) => x.text, clip: true }, { label: "Autor", get: (x) => x.author }, { label: "Favoriten", get: (x) => fmt(x.favs), num: true }], s.top_quotes)}</section>
        <section class="panel"><h3>Beliebteste Autoren</h3><p class="desc">Nach Favoriten</p>
          ${table([{ label: "Autor", get: (x) => x.author }, { label: "Favoriten", get: (x) => fmt(x.favs), num: true }], s.top_authors)}</section>
        <section class="panel"><h3>Top-Nutzer</h3><p class="desc">Nach Punkten</p>
          ${table([{ label: "Nutzer", get: (x) => x.username }, { label: "Punkte", get: (x) => fmt(x.points), num: true }, { label: "Aktive Tage", get: (x) => fmt(x.days), num: true }], s.top_users)}</section>
      </div>`;

    const c = PROJECTS.zitat.color;
    lineChart("z-active", labels, [{ label: "Aktive Nutzer", color: c, data: s.daily.map((d) => d.active) }]);
    barChart("z-signups", labels, s.daily.map((d) => d.signups), c, "Neue Nutzer");
    barChart("z-weekday", ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"], s.weekday.map((d) => d.n), c, "App-Öffnungen");
    lineChart("z-inter", labels, inter);
    barChart("z-activedays", s.active_days_30.map((d) => d.bucket), s.active_days_30.map((d) => d.n), c, "Nutzer");
    barChart("z-quiz", s.quiz_scores.map((d) => `${d.score}/5`), s.quiz_scores.map((d) => d.n), c, "Runden");
    if (reactions.length) barChart("z-reactions", reactions.map(([e]) => e), reactions.map(([, n]) => n), c, "Reaktionen");
  }

  // ---------- Statistik: Wort
  async function renderWortStats() {
    const p = "wort";
    view().innerHTML = head("Wort des Tages · Statistik") + loading();
    const s = await loadStats(p);
    if (!s) { view().innerHTML = head("Wort des Tages · Statistik") + `<div class="note-box">${esc(statsError[p])}</div>`; return; }
    const t = s.totals, r = s.retention, n = s.notifications;
    const labels = s.daily.map((d) => shortDay(d.day));
    const inter = [
      { label: "Wort verwendet", key: "used" }, { label: "Favoriten", key: "favorites" }, { label: "Eigene Wörter", key: "personal" },
      { label: "Bewertungen", key: "votes" }, { label: "Erinnerung geöffnet", key: "notif_clicks" },
    ].map((x, i) => ({ ...x, color: SERIES[i], data: s.daily.map((d) => d[x.key]) }));
    const notifTotal = (n.enabled || 0) + (n.disabled || 0);

    view().innerHTML = head("Wort des Tages · Statistik", `Stand ${longDay(s.today)}`) + `
      <div class="tiles">
        ${tile("Nutzer gesamt", fmt(s.users_total), `+${fmt(s.new_today)} heute`, "accent-wort")}
        ${tile("Neu (7 / 30 Tage)", `${fmt(s.new_7)} / ${fmt(s.new_30)}`, "", "accent-wort")}
        ${tile("Aktiv heute", fmt(s.active_today), "", "accent-wort")}
        ${tile("Aktiv (7 / 30 Tage)", `${fmt(s.active_7)} / ${fmt(s.active_30)}`, "", "accent-wort")}
        ${tile("Bindung (aktiv heute / 30 Tage)", s.active_30 ? pct(Math.round((100 * s.active_today) / s.active_30)) : "–", "Anteil der Monatsnutzer, die heute da waren", "accent-wort")}
        ${tile("Erinnerung aktiv", notifTotal ? pct(Math.round((100 * n.enabled) / notifTotal)) : "–", `${fmt(n.enabled)} von ${fmt(notifTotal)} Nutzern`, "accent-wort")}
      </div>
      <h2 class="section-title">Wiederkehr nach der Registrierung</h2>
      <div class="tiles">
        ${tile("Am nächsten Tag", pct(r.d1), `von ${fmt(r.d1_n)} Neuen (letzte 90 Tage)`)}
        ${tile("In Woche 2", pct(r.d7), `von ${fmt(r.d7_n)} Neuen`)}
        ${tile("Nach 30 Tagen", pct(r.d30), `von ${fmt(r.d30_n)} Neuen`)}
      </div>
      <p class="muted small" style="margin-top:8px">Der genaue Verlauf der App-Starts wird erst seit Einrichtung des Dashboards gespeichert; ältere Tage sind aus der Nutzung rekonstruiert und eher zu niedrig.</p>
      <h2 class="section-title">Verlauf (60 Tage)</h2>
      <div class="charts">
        ${panel("w-active", "Aktive Nutzer pro Tag", "", true)}
        ${panel("w-signups", "Neue Registrierungen pro Tag")}
        ${panel("w-weekday", "Aktivität nach Wochentag", "App-Öffnungen der letzten 90 Tage")}
        ${panel("w-inter", "Aktionen pro Tag", "", true, inter)}
        ${panel("w-activedays", "Wie oft kommen Nutzer?", "Aktive Tage pro Nutzer in den letzten 30 Tagen")}
        ${panel("w-levels", "Level der Nutzer")}
        ${panel("w-streaks", "Aktuelle Serien", "Tage in Folge geöffnet")}
        ${panel("w-hours", "Uhrzeit der Erinnerung", "Nutzer mit aktiver Erinnerung")}
      </div>
      <h2 class="section-title">Gesamt</h2>
      <div class="tiles">
        ${tile("Erschienene Wörter", fmt(t.words), `${fmt(t.community_words)} aus der Community`)}
        ${tile("Wort verwendet", fmt(t.used))}
        ${tile("Favoriten", fmt(t.favorites))}
        ${tile("Eigene Wörter", fmt(t.personal))}
        ${tile("Bewertungen", fmt(t.votes))}
        ${tile("Erinnerung geöffnet", fmt(t.notif_clicks))}
        ${tile("Freundschaften", fmt(t.friendships))}
        ${tile("Wort-Vorschläge", fmt(t.suggestions), `${fmt(t.suggestions_accepted)} angenommen`)}
        ${tile("App-Ideen", fmt(t.ideas))}
      </div>
      <div class="charts" style="margin-top:14px">
        <section class="panel"><h3>Am häufigsten verwendet</h3>
          ${table([{ label: "Wort", get: (x) => x.wort }, { label: "Datum", get: (x) => shortDay(x.datum) }, { label: "Verwendet", get: (x) => fmt(x.n), num: true }], s.top_used)}</section>
        <section class="panel"><h3>Am häufigsten favorisiert</h3>
          ${table([{ label: "Wort", get: (x) => x.wort }, { label: "Datum", get: (x) => shortDay(x.datum) }, { label: "Favoriten", get: (x) => fmt(x.n), num: true }], s.top_favorites)}</section>
        <section class="panel wide"><h3>Top-Nutzer</h3><p class="desc">Nach Erfahrungspunkten</p>
          ${table([{ label: "Nutzer", get: (x) => x.name }, { label: "Level", get: (x) => LEVELS[x.level_key] || x.level_key }, { label: "XP", get: (x) => fmt(x.xp), num: true }, { label: "Beste Serie", get: (x) => fmt(x.best_streak), num: true }], s.top_users)}</section>
      </div>`;

    const c = PROJECTS.wort.color;
    lineChart("w-active", labels, [{ label: "Aktive Nutzer", color: c, data: s.daily.map((d) => d.active) }]);
    barChart("w-signups", labels, s.daily.map((d) => d.signups), c, "Neue Nutzer");
    barChart("w-weekday", ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"], s.weekday.map((d) => d.n), c, "App-Öffnungen");
    lineChart("w-inter", labels, inter);
    barChart("w-activedays", s.active_days_30.map((d) => d.bucket), s.active_days_30.map((d) => d.n), c, "Nutzer");
    barChart("w-levels", s.levels.map((d) => LEVELS[d.level] || d.level), s.levels.map((d) => d.n), c, "Nutzer");
    barChart("w-streaks", s.streaks.map((d) => d.bucket), s.streaks.map((d) => d.n), c, "Nutzer");
    barChart("w-hours", (n.by_hour || []).map((d) => `${d.hour} Uhr`), (n.by_hour || []).map((d) => d.n), c, "Nutzer");
  }

  // ---------- Planung: Zitat
  const zitatPlanState = { from: null };
  async function renderZitatPlan() {
    const p = "zitat";
    const today = todayIso();
    if (!zitatPlanState.from) zitatPlanState.from = today;
    const from = zitatPlanState.from, to = shiftIso(from, 59);
    const toolbar = `<div class="toolbar">
      <button class="btn small" data-shift="-60">← 60 Tage</button>
      <button class="btn small" data-shift="0">Heute</button>
      <button class="btn small" data-shift="60">60 Tage →</button>
      ${jumpControls(from)}
      <button class="btn small primary" data-add>+ Zitat ohne Datum</button></div>`;
    view().innerHTML = head("Zitat des Tages · Planung", `${shortDay(from)} – ${shortDay(to)}`, toolbar) + loading();
    let rows;
    try { rows = await rpc(p, "admin_plan", { from_day: from, to_day: to }); }
    catch (e) { view().innerHTML = head("Zitat des Tages · Planung", "", toolbar) + `<div class="note-box">${esc(e.message)}</div>`; bindPlanToolbar(); return; }
    const byDay = Object.fromEntries((rows || []).map((r) => [r.day, r]));
    const list = [];
    for (let d = from; d <= to; d = shiftIso(d, 1)) list.push(byDay[d] || { day: d });
    const gaps = list.filter((r) => !r.text && r.day > today).length;

    view().innerHTML = head("Zitat des Tages · Planung", `${shortDay(from)} – ${shortDay(to)} · ${gaps ? `${gaps} offene Tage` : "alle Tage geplant"}`, toolbar) +
      `<div class="plan">${list.map((r) => `
        <div class="plan-row${r.text ? "" : " gap"}${r.day === today ? " today" : ""}" data-day="${r.day}" tabindex="0">
          <div class="date"><b>${wdDay(r.day)}</b>${r.day === today ? "heute" : ""}</div>
          <div class="content"><div class="main">${r.text ? esc(r.text) : (r.day < today ? "Zufälliges Zitat (beim Abruf vergeben)" : "Noch nicht geplant – wird sonst automatisch gewählt")}</div>
            ${r.text ? `<div class="by">— ${esc(r.author)}${r.source ? ` · ${esc(r.source)}` : ""}${r.year ? ` · ${esc(r.year)}` : ""}</div>` : ""}</div>
          <span class="muted small">${r.text ? "Bearbeiten" : "Planen"}</span>
        </div>`).join("")}</div>`;
    bindPlanToolbar();
    view().querySelectorAll(".plan-row").forEach((el) => {
      const open = () => editZitatDay(byDay[el.dataset.day] || { day: el.dataset.day });
      el.addEventListener("click", open);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
    });

    function bindPlanToolbar() {
      view().querySelectorAll("[data-shift]").forEach((b) => b.addEventListener("click", () => {
        const n = Number(b.dataset.shift);
        zitatPlanState.from = n === 0 ? todayIso() : shiftIso(zitatPlanState.from, n);
        renderZitatPlan();
      }));
      bindJump("zitat", zitatPlanState, renderZitatPlan);
      view().querySelector("[data-add]")?.addEventListener("click", addZitatWithoutDay);
    }
  }

  // Datum anspringen und zur nächsten freien Stelle springen (für beide Planungen)
  const jumpControls = (from) => `
    <input type="date" data-jump value="${from}" aria-label="Zu Datum springen" style="width:auto;padding:6px 10px">
    <button class="btn small" data-gap>Nächste Lücke</button>`;

  function bindJump(p, state, render) {
    view().querySelector("[data-jump]")?.addEventListener("change", (e) => {
      if (!e.target.value) return;
      state.from = e.target.value;
      render();
    });
    view().querySelector("[data-gap]")?.addEventListener("click", async () => {
      const s = await loadStats(p, true);
      const gap = s?.planning?.first_gap;
      if (!gap) return toast("Keine Lücke in den nächsten 2 Jahren");
      state.from = shiftIso(gap, -3) < todayIso() ? todayIso() : shiftIso(gap, -3);
      render();
    });
  }

  const quoteFields = (q = {}) => [
    { name: "text", label: "Zitat", type: "textarea", value: q.text, required: true },
    [{ name: "author", label: "Autor", value: q.author, required: true }, { name: "year", label: "Jahr", value: q.year, placeholder: "z. B. 1903" }],
    { name: "source", label: "Quelle", value: q.source, placeholder: "Werk, Rede, Brief …" },
    { name: "explanation", label: "Zum Zitat (Erklärung)", type: "textarea", value: q.explanation },
  ];

  function editZitatDay(r) {
    formDialog({
      title: `Zitat für ${longDay(r.day)}`,
      fields: quoteFields(r),
      danger: r.text ? "Tag leeren" : null,
      onSubmit: async (d) => {
        await rpc("zitat", "admin_set_day", { p_day: r.day, p_text: d.text, p_author: d.author, p_source: nullIfEmpty(d.source), p_year: nullIfEmpty(d.year), p_explanation: nullIfEmpty(d.explanation) });
        toast("Gespeichert");
        stats.zitat = null;
        renderZitatPlan();
      },
      onDanger: async () => {
        if (!confirm("Diesen Tag wirklich leeren? Das Zitat bleibt in der Datenbank.")) throw new Error("Abgebrochen");
        await rpc("zitat", "admin_clear_day", { p_day: r.day });
        toast("Tag geleert");
        renderZitatPlan();
      },
    });
  }

  function addZitatWithoutDay() {
    formDialog({
      title: "Neues Zitat",
      intro: `<p class="muted small">Ohne Datum kommt es in den Pool und wird an einem freien Tag automatisch gezeigt.</p>`,
      fields: quoteFields(),
      submit: "Hinzufügen",
      onSubmit: async (d) => {
        await rpc("zitat", "admin_add_quote", { p_text: d.text, p_author: d.author, p_source: nullIfEmpty(d.source), p_day: null, p_year: nullIfEmpty(d.year), p_explanation: nullIfEmpty(d.explanation) });
        toast("Zitat hinzugefügt");
        stats.zitat = null;
      },
    });
  }

  // ---------- Vorschläge: Zitat
  async function renderZitatSuggestions() {
    const p = "zitat";
    view().innerHTML = head("Zitat des Tages · Vorschläge") + loading();
    let rows;
    try { rows = await api(p, "suggestions?select=id,text,author,source,created_at,profiles(username)&status=eq.pending&order=created_at.asc"); }
    catch (e) { view().innerHTML = head("Zitat des Tages · Vorschläge") + `<div class="note-box">${esc(e.message)}</div>`; return; }
    view().innerHTML = head("Zitat des Tages · Vorschläge", `${rows.length} offen`) + (rows.length ? `<div class="list">${rows.map((r) => `
      <article class="item" data-id="${r.id}">
        <div class="meta">von ${esc(r.profiles?.username || "?")} · ${dateTime(r.created_at)}</div>
        <div class="body">„${esc(r.text)}“<br><span class="muted">— ${esc(r.author)}${r.source ? ` · ${esc(r.source)}` : ""}</span></div>
        <div class="actions"><button class="btn small good" data-accept>Annehmen</button><button class="btn small" data-edit>Bearbeiten</button><button class="btn small danger" data-reject>Ablehnen</button></div>
      </article>`).join("")}</div>` : `<p class="empty">Keine offenen Vorschläge.</p>`);
    view().querySelectorAll(".item").forEach((el) => {
      const id = Number(el.dataset.id);
      const r = rows.find((x) => x.id === id);
      el.querySelector("[data-edit]").onclick = () => formDialog({
        title: "Vorschlag bearbeiten",
        intro: `<p class="muted small">Zum Beispiel Rechtschreibung korrigieren – danach annehmen.</p>`,
        fields: [
          { name: "text", label: "Zitat", type: "textarea", value: r.text, required: true },
          [{ name: "author", label: "Autor", value: r.author, required: true }, { name: "source", label: "Quelle", value: r.source }],
        ],
        onSubmit: async (d) => {
          await api(p, `suggestions?id=eq.${id}`, { method: "PATCH", body: { text: d.text, author: d.author, source: nullIfEmpty(d.source) }, prefer: "return=minimal" });
          toast("Vorschlag geändert");
          renderZitatSuggestions();
        },
      });
      const act = async (accept) => {
        el.querySelectorAll("button").forEach((b) => { b.disabled = true; });
        try {
          await rpc(p, "review_suggestion", { p_id: id, p_accept: accept });
          toast(accept ? "Angenommen – das Zitat ist jetzt im Pool" : "Abgelehnt");
          el.remove();
          stats.zitat = null; loadStats("zitat");
        } catch (e) { toast(e.message, true); el.querySelectorAll("button").forEach((b) => { b.disabled = false; }); }
      };
      el.querySelector("[data-accept]").onclick = () => act(true);
      el.querySelector("[data-reject]").onclick = () => act(false);
    });
  }

  // ---------- Meldungen: Zitat
  async function renderZitatReports() {
    const p = "zitat";
    view().innerHTML = head("Zitat des Tages · Meldungen") + loading();
    let rows;
    try { rows = await rpc(p, "admin_reports"); }
    catch (e) { view().innerHTML = head("Zitat des Tages · Meldungen") + `<div class="note-box">${esc(e.message)}</div>`; return; }
    view().innerHTML = head("Zitat des Tages · Meldungen", `${rows.length} offen`) + (rows.length ? `<div class="list">${rows.map((r, i) => `
      <article class="item" data-i="${i}">
        <div class="meta">${r.post_id ? (r.kind === "thought" ? "Gedanke" : "Zitat-Beitrag") : "Profil"} von ${esc(r.username || "?")} · ${fmt(r.reports)}× gemeldet · zuletzt ${dateTime(r.last_at)}</div>
        <div class="body">${esc(r.text)}</div>
        <div class="meta">Gründe: ${esc(r.reasons)}</div>
        <div class="actions">
          ${r.post_id ? `<button class="btn small danger" data-delete>Beitrag löschen</button>` : ""}
          <button class="btn small" data-keep>${r.post_id ? "Behalten (erledigt)" : "Erledigt"}</button>
        </div>
      </article>`).join("")}</div>` : `<p class="empty">Keine offenen Meldungen.</p>`);
    view().querySelectorAll(".item").forEach((el) => {
      const r = rows[Number(el.dataset.i)];
      const act = async (del) => {
        if (del && !confirm("Beitrag endgültig löschen?")) return;
        el.querySelectorAll("button").forEach((b) => { b.disabled = true; });
        try {
          await rpc(p, "admin_resolve_report", { p_post: r.post_id, p_user: r.user_id, p_delete: del });
          toast(del ? "Beitrag gelöscht" : "Erledigt");
          el.remove();
          stats.zitat = null; loadStats("zitat");
        } catch (e) { toast(e.message, true); el.querySelectorAll("button").forEach((b) => { b.disabled = false; }); }
      };
      el.querySelector("[data-delete]")?.addEventListener("click", () => act(true));
      el.querySelector("[data-keep]").addEventListener("click", () => act(false));
    });
  }

  // ---------- App-Ideen: Zitat
  async function renderZitatIdeas() {
    const p = "zitat";
    view().innerHTML = head("Zitat des Tages · App-Ideen") + loading();
    let rows;
    try { rows = await api(p, "ideas?select=id,text,created_at,profiles(username)&order=created_at.desc"); }
    catch (e) { view().innerHTML = head("Zitat des Tages · App-Ideen") + `<div class="note-box">${esc(e.message)}</div>`; return; }
    view().innerHTML = head("Zitat des Tages · App-Ideen", `${rows.length} Ideen`) + (rows.length ? `<div class="list">${rows.map((r) => `
      <article class="item" data-id="${r.id}">
        <div class="meta">von ${esc(r.profiles?.username || "?")} · ${dateTime(r.created_at)}</div>
        <div class="body">${esc(r.text)}</div>
        <div class="actions"><button class="btn small" data-done>Erledigt – entfernen</button></div>
      </article>`).join("")}</div>` : `<p class="empty">Keine App-Ideen.</p>`);
    view().querySelectorAll(".item").forEach((el) => {
      el.querySelector("[data-done]").onclick = async () => {
        try {
          await api(p, `ideas?id=eq.${Number(el.dataset.id)}`, { method: "DELETE" });
          el.remove(); toast("Entfernt");
          stats.zitat = null; loadStats("zitat");
        } catch (e) { toast(e.message, true); }
      };
    });
  }

  // ---------- Neue Nutzer: Zitat
  async function renderZitatUsers() {
    const p = "zitat";
    view().innerHTML = head("Zitat des Tages · Neue Nutzer") + loading();
    let rows;
    try { rows = await rpc(p, "admin_new_users", { p_days: 30 }); }
    catch (e) { view().innerHTML = head("Zitat des Tages · Neue Nutzer") + `<div class="note-box">${esc(e.message)}</div>`; return; }
    view().innerHTML = head("Zitat des Tages · Neue Nutzer", `${rows.length} in den letzten 30 Tagen`) + `<section class="panel">${table([
      { label: "Nutzer", html: (x) => `${esc(x.avatar && !x.avatar.startsWith("ADMIN") ? x.avatar : "")} ${esc(x.username)}` },
      { label: "E-Mail", get: (x) => x.email },
      { label: "Registriert", get: (x) => dateTime(x.created_at) },
      { label: "Zuletzt aktiv", get: (x) => (x.last_seen ? shortDay(x.last_seen) : "–") },
      { label: "Punkte", get: (x) => fmt(x.points), num: true },
      { label: "Bestätigt", get: (x) => (x.confirmed ? "✓" : "–") },
    ], rows, "Keine neuen Nutzer.")}</section>`;
  }

  // ---------- Planung: Wort
  const wortPlanState = { from: null };
  async function renderWortPlan() {
    const p = "wort";
    const today = todayIso();
    if (!wortPlanState.from) wortPlanState.from = today;
    const from = wortPlanState.from, to = shiftIso(from, 59);
    const toolbar = `<div class="toolbar">
      <button class="btn small" data-shift="-60">← 60 Tage</button>
      <button class="btn small" data-shift="0">Heute</button>
      <button class="btn small" data-shift="60">60 Tage →</button>
      ${jumpControls(from)}</div>`;
    view().innerHTML = head("Wort des Tages · Planung", `${shortDay(from)} – ${shortDay(to)}`, toolbar) + loading();
    let rows;
    try {
      rows = await api(p, `words?select=id,wort,lautschrift,wortart,definition,beispielsatz,synonyme,datum,is_community&and=(datum.gte.${from},datum.lte.${to})&order=datum.asc`);
    } catch (e) { view().innerHTML = head("Wort des Tages · Planung", "", toolbar) + `<div class="note-box">${esc(e.message)}</div>`; bindToolbar(); return; }
    const byDay = Object.fromEntries(rows.map((r) => [r.datum, r]));
    const list = [];
    for (let d = from; d <= to; d = shiftIso(d, 1)) list.push(byDay[d] || { datum: d });
    const gaps = list.filter((r) => !r.wort && r.datum >= today).length;

    view().innerHTML = head("Wort des Tages · Planung", `${shortDay(from)} – ${shortDay(to)} · ${gaps ? `${gaps} offene Tage` : "alle Tage geplant"}`, toolbar) +
      `<div class="plan">${list.map((r) => `
        <div class="plan-row${r.wort ? "" : " gap"}${r.datum === today ? " today" : ""}" data-day="${r.datum}" tabindex="0">
          <div class="date"><b>${wdDay(r.datum)}</b>${r.datum === today ? "heute" : ""}</div>
          <div class="content"><div class="main">${r.wort ? `<strong>${esc(r.wort)}</strong> <span class="muted">${esc(r.wortart || "")}${r.is_community ? " · Community-Vorschlag" : ""}</span>` : "Noch kein Wort geplant"}</div>
            ${r.wort ? `<div class="by">${esc(r.definition)}</div>` : ""}</div>
          <span class="muted small">${r.wort ? "Bearbeiten" : "Planen"}</span>
        </div>`).join("")}</div>`;
    bindToolbar();
    view().querySelectorAll(".plan-row").forEach((el) => {
      const open = () => editWord(byDay[el.dataset.day] || { datum: el.dataset.day });
      el.addEventListener("click", open);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
    });

    function bindToolbar() {
      view().querySelectorAll("[data-shift]").forEach((b) => b.addEventListener("click", () => {
        const n = Number(b.dataset.shift);
        wortPlanState.from = n === 0 ? todayIso() : shiftIso(wortPlanState.from, n);
        renderWortPlan();
      }));
      bindJump("wort", wortPlanState, renderWortPlan);
    }
  }

  const wordFields = (w = {}, withDate = true) => [
    [{ name: "wort", label: "Wort", value: w.wort, required: true }, { name: "wortart", label: "Wortart", value: w.wortart, placeholder: "Substantiv, Verb …" }],
    { name: "lautschrift", label: "Lautschrift", value: w.lautschrift, placeholder: "[…]" },
    { name: "definition", label: "Bedeutung", type: "textarea", value: w.definition, required: true },
    { name: "beispielsatz", label: "Beispielsatz", type: "textarea", value: w.beispielsatz },
    withDate
      ? [{ name: "synonyme", label: "Synonyme (mit Komma getrennt)", value: (w.synonyme || []).join(", ") }, { name: "datum", label: "Datum", type: "date", value: w.datum, required: true }]
      : { name: "synonyme", label: "Synonyme (mit Komma getrennt)", value: (w.synonyme || []).join(", ") },
  ];
  const synList = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);

  function editWord(w) {
    const exists = !!w.id;
    formDialog({
      title: exists ? `„${w.wort}“ bearbeiten` : `Wort für ${longDay(w.datum)}`,
      fields: wordFields(w),
      danger: exists ? "Löschen" : null,
      submit: exists ? "Speichern" : "Planen",
      onSubmit: async (d) => {
        const body = { wort: d.wort, wortart: nullIfEmpty(d.wortart), lautschrift: nullIfEmpty(d.lautschrift), definition: d.definition, beispielsatz: nullIfEmpty(d.beispielsatz), synonyme: synList(d.synonyme), datum: d.datum };
        if (exists) await api("wort", `words?id=eq.${encodeURIComponent(w.id)}`, { method: "PATCH", body, prefer: "return=minimal" });
        else await api("wort", "words", { method: "POST", body, prefer: "return=minimal" });
        toast(exists ? "Gespeichert" : "Wort geplant");
        stats.wort = null;
        renderWortPlan();
      },
      onDanger: async () => {
        if (!confirm(`„${w.wort}“ wirklich löschen?`)) throw new Error("Abgebrochen");
        await api("wort", `words?id=eq.${encodeURIComponent(w.id)}`, { method: "DELETE" });
        toast("Gelöscht");
        renderWortPlan();
      },
    });
  }

  async function firstFreeWordDay() {
    const s = await loadStats("wort");
    return s?.planning?.first_gap || shiftIso(todayIso(), 1);
  }

  // Erster Tag ab `from` ohne geplantes Wort
  async function nextFreeWordDay(from) {
    const taken = new Set((await api("wort", `words?select=datum&and=(datum.gte.${from},datum.lte.${shiftIso(from, 730)})`)).map((w) => w.datum));
    let d = from;
    while (taken.has(d)) d = shiftIso(d, 1);
    return d;
  }

  // ---------- Vorschläge: Wort
  async function renderWortSuggestions() {
    const p = "wort";
    view().innerHTML = head("Wort des Tages · Vorschläge") + loading();
    let rows;
    try { rows = await api(p, "word_suggestions?select=id,wort,begruendung,created_at,profiles(name)&status=eq.offen&order=created_at.asc"); }
    catch (e) { view().innerHTML = head("Wort des Tages · Vorschläge") + `<div class="note-box">${esc(e.message)}</div>`; return; }
    view().innerHTML = head("Wort des Tages · Vorschläge", `${rows.length} offen`) + (rows.length ? `<div class="list">${rows.map((r) => `
      <article class="item" data-id="${esc(r.id)}">
        <div class="meta">von ${esc(r.profiles?.name || "?")} · ${dateTime(r.created_at)} <span data-dupe></span></div>
        <div class="body"><strong>${esc(r.wort)}</strong><br><span class="muted">${esc(r.begruendung)}</span></div>
        <div class="actions"><button class="btn small good" data-accept>Annehmen …</button><button class="btn small" data-edit>Bearbeiten</button><button class="btn small danger" data-reject>Ablehnen …</button></div>
      </article>`).join("")}</div>` : `<p class="empty">Keine offenen Vorschläge.</p>`);

    view().querySelectorAll(".item").forEach((el) => {
      const r = rows.find((x) => String(x.id) === el.dataset.id);

      el.querySelector("[data-edit]").onclick = () => formDialog({
        title: "Vorschlag bearbeiten",
        intro: `<p class="muted small">Zum Beispiel Rechtschreibung korrigieren – danach annehmen.</p>`,
        fields: [
          { name: "wort", label: "Wort", value: r.wort, required: true },
          { name: "begruendung", label: "Begründung", type: "textarea", value: r.begruendung, required: true },
        ],
        onSubmit: async (d) => {
          await api(p, `word_suggestions?id=eq.${encodeURIComponent(r.id)}`, { method: "PATCH", body: { wort: d.wort, begruendung: d.begruendung }, prefer: "return=minimal" });
          toast("Vorschlag geändert");
          renderWortSuggestions();
        },
      });
      // Gab es das Wort schon?
      api(p, `words?select=datum&wort=ilike.${encodeURIComponent(r.wort)}`).then((hits) => {
        if (hits.length) el.querySelector("[data-dupe]").innerHTML = ` · <span style="color:var(--warn)">schon am ${hits.map((h) => shortDay(h.datum)).join(", ")} verwendet</span>`;
      }).catch(() => {});

      el.querySelector("[data-reject]").onclick = () => formDialog({
        title: `„${r.wort}“ ablehnen`,
        fields: [{ name: "note", label: "Begründung für den Nutzer (optional)", type: "textarea" }],
        submit: "Ablehnen",
        onSubmit: async (d) => {
          await rpc(p, "reject_suggestion", { p_suggestion_id: r.id, p_review_note: nullIfEmpty(d.note) });
          toast("Abgelehnt"); el.remove(); stats.wort = null; loadStats("wort");
        },
      });

      el.querySelector("[data-accept]").onclick = async () => {
        const datum = await firstFreeWordDay();
        const occupant = async (day) => (await api(p, `words?select=id,wort&datum=eq.${day}`))[0] || null;
        formDialog({
          title: `„${r.wort}“ annehmen`,
          intro: `<p class="muted small">Das Wort wird als Community-Wort eingeplant und der Nutzer bekommt Punkte. Du kannst jeden Tag wählen – auch einen, an dem schon ein Wort geplant ist.</p>`,
          fields: [
            [{ name: "wort", label: "Wort (Schreibweise prüfen)", value: r.wort, required: true }, { name: "wortart", label: "Wortart", placeholder: "Substantiv, Verb …" }],
            { name: "lautschrift", label: "Lautschrift" },
            { name: "definition", label: "Bedeutung", type: "textarea", required: true },
            { name: "beispielsatz", label: "Beispielsatz", type: "textarea" },
            [{ name: "synonyme", label: "Synonyme (mit Komma getrennt)" }, { name: "datum", label: "Datum", type: "date", value: datum, required: true, help: "Freier Tag" }],
            { name: "replace", label: "Wenn an diesem Tag schon ein Wort geplant ist", type: "select", value: "move", options: [
              { value: "move", label: "Bisheriges Wort auf den nächsten freien Tag verschieben" },
              { value: "delete", label: "Bisheriges Wort löschen und ersetzen" },
            ] },
            [{ name: "points", label: "Punkte für den Nutzer", type: "number", value: "20", min: 0 }, { name: "note", label: "Notiz an den Nutzer" }],
          ],
          submit: "Annehmen & planen",
          onOpen: (form) => {
            const input = form.querySelector('[name="datum"]');
            const help = form.querySelector('[data-help="datum"]');
            const check = async () => {
              if (!input.value) return;
              const o = await occupant(input.value).catch(() => null);
              help.innerHTML = o ? `<span style="color:var(--warn)">Belegt mit „${esc(o.wort)}“ – wird ersetzt (siehe unten)</span>` : "Freier Tag";
            };
            input.addEventListener("change", check);
            check();
          },
          onSubmit: async (d) => {
            // Schreibweise korrigiert? Dann zuerst den Vorschlag anpassen – die Datenbank übernimmt das Wort von dort.
            if (d.wort !== r.wort) {
              await api(p, `word_suggestions?id=eq.${encodeURIComponent(r.id)}`, { method: "PATCH", body: { wort: d.wort }, prefer: "return=minimal" });
            }
            // Tag belegt? Bisheriges Wort verschieben oder löschen.
            const o = await occupant(d.datum);
            let moved = "";
            if (o) {
              if (d.replace === "delete") {
                await api(p, `words?id=eq.${encodeURIComponent(o.id)}`, { method: "DELETE" });
              } else {
                const free = await nextFreeWordDay(shiftIso(d.datum, 1));
                await api(p, `words?id=eq.${encodeURIComponent(o.id)}`, { method: "PATCH", body: { datum: free }, prefer: "return=minimal" });
                moved = ` – „${o.wort}“ ist jetzt am ${shortDay(free)}`;
              }
            }
            await rpc(p, "accept_suggestion", {
              p_suggestion_id: r.id, p_lautschrift: nullIfEmpty(d.lautschrift), p_wortart: nullIfEmpty(d.wortart),
              p_definition: d.definition, p_beispielsatz: nullIfEmpty(d.beispielsatz), p_synonyme: synList(d.synonyme),
              p_datum: d.datum, p_points: Number(d.points) || 0, p_review_note: nullIfEmpty(d.note),
            });
            toast(`„${d.wort}“ für ${shortDay(d.datum)} geplant${moved}`);
            stats.wort = null;
            // Direkt zur Planung an diesem Tag springen
            wortPlanState.from = shiftIso(d.datum, -3) < todayIso() ? todayIso() : shiftIso(d.datum, -3);
            location.hash = "#wort-plan";
          },
        });
      };
    });
  }

  // ---------- App-Ideen: Wort
  async function renderWortIdeas() {
    const p = "wort";
    view().innerHTML = head("Wort des Tages · App-Ideen") + loading();
    let rows;
    try { rows = await api(p, "app_ideas?select=id,title,body,created_at,profiles(name)&status=eq.offen&order=created_at.asc"); }
    catch (e) { view().innerHTML = head("Wort des Tages · App-Ideen") + `<div class="note-box">${esc(e.message)}</div>`; return; }
    view().innerHTML = head("Wort des Tages · App-Ideen", `${rows.length} offen`) + (rows.length ? `<div class="list">${rows.map((r) => `
      <article class="item" data-id="${esc(r.id)}">
        <div class="meta">von ${esc(r.profiles?.name || "?")} · ${dateTime(r.created_at)}</div>
        <div class="body"><strong>${esc(r.title)}</strong><br>${esc(r.body)}</div>
        <div class="actions"><button class="btn small" data-done>Antworten & abschließen …</button></div>
      </article>`).join("")}</div>` : `<p class="empty">Keine offenen App-Ideen.</p>`);
    view().querySelectorAll(".item").forEach((el) => {
      const r = rows.find((x) => String(x.id) === el.dataset.id);
      el.querySelector("[data-done]").onclick = () => formDialog({
        title: `„${r.title}“ abschließen`,
        fields: [{ name: "response", label: "Antwort an den Nutzer", type: "textarea", required: true }],
        submit: "Abschließen",
        onSubmit: async (d) => {
          await rpc(p, "complete_app_idea", { p_idea_id: r.id, p_admin_response: d.response });
          toast("Abgeschlossen"); el.remove(); stats.wort = null; loadStats("wort");
        },
      });
    });
  }

  // ---------- Neue Nutzer: Wort
  async function renderWortUsers() {
    const p = "wort";
    view().innerHTML = head("Wort des Tages · Neue Nutzer") + loading();
    const s = await loadStats(p);
    if (!s) { view().innerHTML = head("Wort des Tages · Neue Nutzer") + `<div class="note-box">${esc(statsError[p])}</div>`; return; }
    const rows = s.recent_users || [];
    view().innerHTML = head("Wort des Tages · Neue Nutzer", `${rows.length} in den letzten 30 Tagen`) + `<section class="panel">${table([
      { label: "Nutzer", get: (x) => x.name || "–" },
      { label: "E-Mail", get: (x) => x.email },
      { label: "Registriert", get: (x) => dateTime(x.created_at) },
      { label: "Zuletzt aktiv", get: (x) => (x.last_seen ? shortDay(x.last_seen) : "–") },
      { label: "XP", get: (x) => fmt(x.xp), num: true },
      { label: "Serie", get: (x) => fmt(x.streak_count), num: true },
    ], rows, "Keine neuen Nutzer.")}</section>`;
  }

  // ---------- Social Media: Historie beider Apps
  const PLATFORMS = {
    zitat: ["instagram", "facebook", "tiktok", "youtube", "threads", "x"],
    wort: ["youtube", "tiktok", "instagram", "facebook", "pinterest", "threads", "x"],
  };
  const PLATFORM_NAMES = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", threads: "Threads", x: "X", pinterest: "Pinterest" };
  const SOCIAL_STATE = {
    sent: { icon: "✓", label: "Veröffentlicht", cls: "ok" },
    scheduled: { icon: "✓", label: "Veröffentlicht", cls: "ok" }, // ältere Einträge der Zitat-Pipeline
    failed: { icon: "✗", label: "Fehlgeschlagen", cls: "bad" },
    skipped: { icon: "✗", label: "Nicht ausgeführt", cls: "bad" },
  };

  // Historie aus den Pipeline-Einträgen, ergänzt um die tatsächlich gefundenen Beiträge (mit Link zum Beitrag)
  function socialGrid(p, rows, posts) {
    const by = {}, found = {}, count = {};
    rows.forEach((r) => { by[`${r.day}|${r.platform}`] = r; });
    posts.forEach((r) => {
      const k = `${r.day}|${r.platform}`;
      count[k] = (count[k] || 0) + 1;
      if (!found[k] || (!found[k].link && r.link)) found[k] = r;
    });
    const platforms = [...new Set([...PLATFORMS[p], ...rows.map((r) => r.platform), ...posts.map((r) => r.platform)])];
    const today = todayIso();
    const first = [...rows, ...posts].reduce((a, r) => (r.day < a ? r.day : a), today);
    const dayList = [];
    for (let d = today; d >= first; d = shiftIso(d, -1)) dayList.push(d);
    let ok = 0, bad = 0, missingDays = 0;
    const body = dayList.map((d) => {
      const cells = platforms.map((pl) => {
        const r = by[`${d}|${pl}`], f = found[`${d}|${pl}`];
        if (!r && !f) return `<td class="soc none" title="Kein Eintrag – nicht gepostet oder Lauf nicht gestartet">–</td>`;
        const n = count[`${d}|${pl}`] || 0;
        let st = f ? SOCIAL_STATE.sent : SOCIAL_STATE[r.status] || { icon: "?", label: r.status, cls: "wait" };
        if (n > 1) st = { icon: `${n}×`, label: `${n}× gepostet – mehrfach`, cls: "dup" };
        if (st.cls === "ok" || st.cls === "dup") ok++; else if (st.cls === "bad") bad++;
        const title = `${PLATFORM_NAMES[pl] || pl}: ${st.label}${!f && r.message ? ` – ${r.message}` : ""}${f?.link ? " – Klick öffnet den Beitrag" : ""}`;
        const inner = f?.link ? `<a href="${esc(f.link)}" target="_blank" rel="noopener">${st.icon}</a>` : st.icon;
        return `<td class="soc ${st.cls}" title="${esc(title)}">${inner}</td>`;
      }).join("");
      const any = platforms.some((pl) => by[`${d}|${pl}`] || found[`${d}|${pl}`]);
      if (!any && d !== today) missingDays++;
      return `<tr${any ? "" : ' class="soc-missing"'}><td>${wdDay(d)}${d === today ? " <span class=\"muted small\">heute</span>" : ""}</td>${cells}</tr>`;
    }).join("");
    const dups = Object.entries(count).filter(([, n]) => n > 1).map(([k, n]) => { const [day, pl] = k.split("|"); return { day, pl, n }; })
      .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
    const summary = `${fmt(ok)} veröffentlicht · ${fmt(bad)} fehlgeschlagen · ${fmt(missingDays)} Tage ganz ohne Eintrag${dups.length ? ` · <b class="bad-text">${fmt(dups.length)}× mehrfach gepostet</b>` : ""} · seit ${shortDay(first)}`;
    return { summary, dups, html: `<div class="table-wrap"><table class="soc-table"><thead><tr><th>Tag</th>${platforms.map((pl) => `<th class="soc">${esc(PLATFORM_NAMES[pl] || pl)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>` };
  }

  // Farbe folgt der Plattform, nie dem Rang (Referenzpalette, dunkle Stufen)
  const PLATFORM_COLOR = { instagram: "#d55181", facebook: "#3987e5", tiktok: "#199e70", youtube: "#e66767", threads: "#9085e9", x: "#c98500", pinterest: "#d95926" };

  // Kennzahlen aus Buffer (Tabelle social_metrics)
  function metricsSection(p, rows) {
    const id = (s) => `sm-${p}-${s}`;
    if (!rows.length) {
      return { html: `<div class="note-box">Noch keine Kennzahlen – sie kommen täglich aus Buffer, sobald der Ablauf „Social-Media-Statistiken“ gelaufen ist.</div>`, draw: () => {} };
    }
    const sum = (k, list = rows) => list.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const platforms = [...new Set(rows.map((r) => r.platform))].sort((a, b) => sum("views", rows.filter((r) => r.platform === b)) - sum("views", rows.filter((r) => r.platform === a)));
    const today = todayIso();
    const first = rows.reduce((a, r) => (r.day < a ? r.day : a), today);
    const dayList = [];
    for (let d = first; d <= today; d = shiftIso(d, 1)) dayList.push(d);
    const since = `seit ${shortDay(first)}`;
    const series = platforms.map((pl) => ({
      label: PLATFORM_NAMES[pl] || pl,
      color: PLATFORM_COLOR[pl] || "#a1a1aa",
      data: dayList.map((d) => sum("views", rows.filter((r) => r.platform === pl && r.day === d))),
    }));
    const per = platforms.map((pl) => {
      const list = rows.filter((r) => r.platform === pl);
      const watch = list.filter((r) => r.avg_watch_sec !== null);
      return {
        pl, posts: list.length, views: sum("views", list), likes: sum("likes", list), comments: sum("comments", list),
        shares: sum("shares", list), saves: sum("saves", list),
        avgWatch: watch.length ? sum("avg_watch_sec", watch) / watch.length : null,
      };
    });
    const top = [...rows].sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0)).slice(0, 10);
    const html = `
      <div class="tiles">
        ${tile("Aufrufe", fmt(Math.round(sum("views"))), `${fmt(rows.length)} Beiträge ${since}`, `accent-${p}`)}
        ${tile("Reichweite", fmt(Math.round(sum("reach"))), "Erreichte Personen", `accent-${p}`)}
        ${tile("Likes", fmt(Math.round(sum("likes"))), "", `accent-${p}`)}
        ${tile("Kommentare", fmt(Math.round(sum("comments"))), "", `accent-${p}`)}
        ${tile("Geteilt", fmt(Math.round(sum("shares"))), "", `accent-${p}`)}
        ${tile("Gespeichert", fmt(Math.round(sum("saves"))), "", `accent-${p}`)}
      </div>
      <div class="charts" style="margin-top:14px">
        ${panel(id("views"), "Aufrufe nach Plattform", `Nach Tag der Veröffentlichung · ${since}`, true, series)}
        <section class="panel wide"><h3>Plattformen im Vergleich</h3><p class="desc">Gesamter Zeitraum · bei X, Facebook und Pinterest zählen Impressionen als Aufrufe</p>
          ${table([
            { label: "Plattform", html: (x) => `<span class="dot" style="background:${PLATFORM_COLOR[x.pl] || "#a1a1aa"}"></span>${esc(PLATFORM_NAMES[x.pl] || x.pl)}` },
            { label: "Beiträge", get: (x) => fmt(x.posts), num: true },
            { label: "Aufrufe", get: (x) => fmt(Math.round(x.views)), num: true },
            { label: "Ø Aufrufe", get: (x) => fmt(Math.round(x.views / (x.posts || 1))), num: true },
            { label: "Likes", get: (x) => fmt(Math.round(x.likes)), num: true },
            { label: "Kommentare", get: (x) => fmt(Math.round(x.comments)), num: true },
            { label: "Geteilt", get: (x) => fmt(Math.round(x.shares)), num: true },
            { label: "Ø Wiedergabe", get: (x) => (x.avgWatch === null ? "–" : `${x.avgWatch.toLocaleString("de-DE", { maximumFractionDigits: 1 })} s`), num: true },
          ], per)}</section>
        <section class="panel wide"><h3>Top-Beiträge</h3><p class="desc">Nach Aufrufen · Klick öffnet den Beitrag</p>
          ${table([
            { label: "Datum", get: (x) => shortDay(x.day) },
            { label: "Plattform", get: (x) => PLATFORM_NAMES[x.platform] || x.platform },
            { label: "Beitrag", html: (x) => x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.text_snippet || "ansehen")}</a>` : esc(x.text_snippet), clip: true },
            { label: "Aufrufe", get: (x) => fmt(Math.round(Number(x.views) || 0)), num: true },
            { label: "Likes", get: (x) => fmt(Math.round(Number(x.likes) || 0)), num: true },
            { label: "Komm.", get: (x) => fmt(Math.round(Number(x.comments) || 0)), num: true },
          ], top)}</section>
      </div>`;
    return { html, draw: () => lineChart(id("views"), dayList.map(shortDay), series) };
  }

  // Follower je Plattform (Tabelle social_followers, im Dashboard eingetragen – Buffer liefert keine Follower)
  function followersSection(p, rows) {
    const id = `fol-${p}`;
    const platforms = PLATFORMS[p];
    const by = {};
    rows.forEach((r) => { (by[r.platform] = by[r.platform] || []).push(r); });
    Object.values(by).forEach((l) => l.sort((a, b) => (a.day < b.day ? -1 : 1)));
    const latest = (pl) => (by[pl] || []).at(-1);
    // Stand vor rund 7 Tagen: letzter Eintrag bis dahin
    const before = (pl, days) => [...(by[pl] || [])].reverse().find((r) => r.day <= shiftIso(todayIso(), -days));
    const diff = (a, b) => (a && b ? a.followers - b.followers : null);
    const sign = (n) => (n === null ? "–" : `${n > 0 ? "+" : ""}${fmt(n)}`);
    const total = platforms.reduce((a, pl) => a + (latest(pl)?.followers || 0), 0);
    const week = platforms.reduce((a, pl) => a + (diff(latest(pl), before(pl, 7)) || 0), 0);
    const days = [...new Set(rows.map((r) => r.day))].sort();
    const series = platforms.filter((pl) => by[pl]).map((pl) => {
      let last = null;
      return { label: PLATFORM_NAMES[pl] || pl, color: PLATFORM_COLOR[pl] || "#a1a1aa",
        data: days.map((d) => { const r = by[pl].find((x) => x.day === d); if (r) last = r.followers; return last; }) };
    });
    const html = `
      <h3 style="margin:22px 0 8px;font-size:15px">Follower</h3>
      <div class="tiles">
        ${tile("Follower gesamt", fmt(total), "Alle Plattformen, letzter Stand", `accent-${p}`)}
        ${tile("Diese Woche", sign(week), "Veränderung in 7 Tagen", `accent-${p}`)}
      </div>
      <div class="charts" style="margin-top:14px">
        <section class="panel wide"><p class="desc">Zahlen von den Profilen abschreiben und speichern – am besten einmal pro Woche. Leere Felder bleiben unverändert.</p>
          <form id="${id}-form">${table([
            { label: "Plattform", html: (pl) => `<span class="dot" style="background:${PLATFORM_COLOR[pl] || "#a1a1aa"}"></span>${esc(PLATFORM_NAMES[pl] || pl)}` },
            { label: "Follower", get: (pl) => (latest(pl) ? fmt(latest(pl).followers) : "–"), num: true },
            { label: "7 Tage", get: (pl) => sign(diff(latest(pl), before(pl, 7))), num: true },
            { label: "30 Tage", get: (pl) => sign(diff(latest(pl), before(pl, 30))), num: true },
            { label: "Stand", get: (pl) => (latest(pl) ? shortDay(latest(pl).day) : "–") },
            { label: "Heute eintragen", html: (pl) => `<input type="number" min="0" inputmode="numeric" name="${pl}" placeholder="${latest(pl)?.followers ?? ""}" style="width:110px">` },
          ], platforms)}
          <div style="margin-top:10px;text-align:right"><span class="muted small" id="${id}-msg"></span> <button class="btn small primary" type="submit">Speichern</button></div></form>
        </section>
        ${series.length && days.length > 1 ? panel(`${id}-chart`, "Follower im Verlauf", "Je Plattform", true, series) : ""}
      </div>`;
    const draw = () => {
      if (series.length && days.length > 1) lineChart(`${id}-chart`, days.map(shortDay), series);
      const form = $(`#${id}-form`);
      if (!form) return;
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const body = [...new FormData(form)].filter(([, v]) => String(v).trim() !== "")
          .map(([platform, v]) => ({ platform, day: todayIso(), followers: Math.round(Number(v)), updated_at: new Date().toISOString() }));
        const msg = $(`#${id}-msg`);
        if (!body.length) { msg.textContent = "Nichts eingetragen."; return; }
        try {
          await api(p, "social_followers", { method: "POST", body, prefer: "resolution=merge-duplicates" });
          renderSocial(p);
        } catch (e) { msg.textContent = e.message; }
      };
    };
    return { html, draw };
  }

  // Video und Post des Vortags auf allen Plattformen
  function yesterdaySection(p, rows) {
    const day = shiftIso(todayIso(), -1);
    const list = rows.filter((r) => r.day === day);
    const platforms = [...new Set([...PLATFORMS[p], ...list.map((r) => r.platform)])];
    const lines = platforms.flatMap((pl) => {
      const own = list.filter((r) => r.platform === pl).sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0));
      return own.length ? own : [{ platform: pl, missing: true }];
    });
    const sum = (k) => list.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const num = (x, k) => (x.missing || x[k] === null || x[k] === undefined ? "–" : fmt(Math.round(Number(x[k]))));
    const stand = list.reduce((a, r) => (r.updated_at && r.updated_at > a ? r.updated_at : a), "");
    return `
      <h3 style="margin:22px 0 8px;font-size:15px">Gestern · ${wdDay(day)}</h3>
      <div class="tiles">
        ${tile("Aufrufe gestern", fmt(Math.round(sum("views"))), `${fmt(list.length)} Beiträge`, `accent-${p}`)}
        ${tile("Likes gestern", fmt(Math.round(sum("likes"))), "", `accent-${p}`)}
        ${tile("Kommentare gestern", fmt(Math.round(sum("comments"))), "", `accent-${p}`)}
      </div>
      <section class="panel wide" style="margin-top:14px"><p class="desc">Video bzw. Post vom Vortag je Plattform · Klick öffnet den Beitrag${stand ? ` · Stand ${dateTime(stand)}` : ""}</p>
        ${table([
          { label: "Plattform", html: (x) => `<span class="dot" style="background:${PLATFORM_COLOR[x.platform] || "#a1a1aa"}"></span>${esc(PLATFORM_NAMES[x.platform] || x.platform)}` },
          { label: "Beitrag", html: (x) => (x.missing ? `<span class="muted">Noch keine Zahlen</span>` : x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.text_snippet || "ansehen")}</a>` : esc(x.text_snippet || "–")), clip: true },
          { label: "Aufrufe", get: (x) => num(x, "views"), num: true },
          { label: "Likes", get: (x) => num(x, "likes"), num: true },
          { label: "Komm.", get: (x) => num(x, "comments"), num: true },
          { label: "Geteilt", get: (x) => num(x, "shares"), num: true },
        ], lines)}</section>`;
  }

  // Welche Wörter/Zitate kommen an? Social-Aufrufe des Tages (je Plattform nur der stärkste Beitrag,
  // damit Mehrfach-Posts nicht doppelt zählen) neben Favoriten und Nutzung in der App.
  function itemsSection(p, items, posts) {
    const id = `items-${p}`;
    const best = {};
    posts.forEach((r) => {
      const k = `${r.day}|${r.platform}`;
      best[k] = Math.max(best[k] || 0, Number(r.views) || 0);
    });
    const views = {};
    Object.entries(best).forEach(([k, v]) => { const d = k.split("|")[0]; views[d] = (views[d] || 0) + v; });
    const rows = items.map((x) => ({ ...x, views: views[x.day] ?? null, app: Number(x.favorites) + Number(x.used) }));
    // Beliebtheit = Mittel der Rangplätze (0–100) bei Social Media und in der App
    const pct = (key) => {
      const list = rows.filter((r) => r[key] !== null).map((r) => r[key]).sort((a, b) => a - b);
      return (v) => (v === null || list.length < 2 ? null : (100 * list.filter((x) => x < v).length) / (list.length - 1));
    };
    const pv = pct("views"), pa = pct("app");
    rows.forEach((r) => {
      const parts = [pv(r.views), pa(r.app)].filter((x) => x !== null);
      r.score = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
    });
    const noun = p === "wort" ? "Wort" : "Zitat";
    const sorts = { score: "Beliebtheit gesamt", views: "Social-Media-Aufrufe", favorites: "Favoriten in der App", used: p === "wort" ? "Benutzt in der App" : "Angewendet in der App", day: "Datum" };
    const body = (key) => {
      const list = [...rows].sort((a, b) => (key === "day" ? (a.day < b.day ? 1 : -1) : (b[key] ?? -1) - (a[key] ?? -1)));
      return table([
        { label: "Datum", get: (x) => shortDay(x.day) },
        { label: noun, html: (x) => `${esc(x.title)}${x.author ? ` <span class="muted small">— ${esc(x.author)}</span>` : ""}`, clip: true },
        { label: "Social-Aufrufe", get: (x) => (x.views === null ? "–" : fmt(Math.round(x.views))), num: true },
        { label: "Favoriten", get: (x) => fmt(x.favorites), num: true },
        { label: sorts.used.replace(" in der App", ""), get: (x) => fmt(x.used), num: true },
        { label: "Beliebtheit", html: (x) => (x.score === null ? "–" : `<span style="white-space:nowrap"><span class="meter"><i style="width:${Math.round(x.score)}%"></i></span> ${Math.round(x.score)}</span>`), num: true },
      ], list, "Noch keine Daten.");
    };
    const html = `
      <h3 style="margin:22px 0 8px;font-size:15px">Was kommt am besten an?</h3>
      <section class="panel wide">
        <p class="desc">Jedes ${noun} mit den Social-Media-Aufrufen seines Tages und wie oft es in der App favorisiert und ${p === "wort" ? "benutzt" : "angewendet"} wurde (ohne Bots). Beliebtheit 100 = überall vorne.
          <label class="small" style="float:right">Sortieren nach <select id="${id}-sort">${Object.entries(sorts).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label></p>
        <div id="${id}-body" style="max-height:520px;overflow:auto">${body("score")}</div>
      </section>`;
    return { html, draw: () => { const s = $(`#${id}-sort`); if (s) s.onchange = () => { $(`#${id}-body`).innerHTML = body(s.value); }; } };
  }

  async function renderSocial(p) {
    const title = `${PROJECTS[p].name} · Social Media`;
    view().innerHTML = head(title) + loading();
    let html = head(title, "Reichweite der täglichen Videos und wo gepostet wurde (gesamter Zeitraum)<!--stand-->", `<button class="btn small" id="soc-refresh">↻ Aktualisieren</button>`);
    let yesterday = "";
    const draws = [];
    try {
      const f = followersSection(p, await api(p, "social_followers?select=platform,day,followers&order=day.asc"));
      html += f.html;
      draws.push(f.draw);
    } catch (e) {
      html += `<h3 style="margin:22px 0 8px;font-size:15px">Follower</h3><div class="note-box">${/social_followers/.test(e.message) ? `Dafür fehlt noch die Tabelle – bitte das SQL „${p === "wort" ? "Wort" : "Zitat"}_4_Follower.sql“ ausführen.` : esc(e.message)}</div>`;
    }
    {
      let posts = [];
      try {
        posts = await api(p, `social_metrics?select=post_id,platform,day,link,text_snippet,views,reach,likes,comments,shares,saves,avg_watch_sec,updated_at&app=eq.${p}&order=day.desc`);
        const m = metricsSection(p, posts);
        html += m.html;
        yesterday = yesterdaySection(p, posts);
        const stand = posts.reduce((a, r) => (r.updated_at && r.updated_at > a ? r.updated_at : a), "");
        if (stand) html = html.replace("<!--stand-->", ` · Zahlen von ${dateTime(stand)}`);
        draws.push(m.draw);
      } catch (e) {
        html += `<div class="note-box">${/social_metrics/.test(e.message) ? "Die Tabelle für die Kennzahlen fehlt noch – bitte das SQL ausführen." : esc(e.message)}</div>`;
      }
      try {
        const items = await rpc(p, "admin_item_stats");
        const s = itemsSection(p, items, posts);
        html += s.html;
        draws.push(s.draw);
      } catch (e) {
        html += `<h3 style="margin:22px 0 8px;font-size:15px">Was kommt am besten an?</h3><div class="note-box">${/admin_item_stats/.test(e.message) ? "Dafür fehlt noch die Funktion – bitte das neue SQL ausführen." : esc(e.message)}</div>`;
      }
      html += `<h3 style="margin:22px 0 8px;font-size:15px">Wurde gepostet?</h3>
        <p class="legend"><span>✓ veröffentlicht (Klick öffnet den Beitrag)</span><span class="bad-text">2× mehrfach gepostet</span><span>✗ fehlgeschlagen</span><span>– kein Eintrag</span></p>`;
      try {
        const rows = await api(p, `social_posts?select=day,platform,status,link,message,updated_at&order=day.desc`);
        const g = socialGrid(p, rows, posts);
        html += `<p class="muted small">${g.summary}</p><section class="panel">${g.html}</section>`;
      } catch (e) {
        html += `<div class="note-box">${/social_posts/.test(e.message) ? "Die Tabelle für die Historie fehlt noch – bitte das SQL ausführen." : esc(e.message)}</div>`;
      }
    }
    html += yesterday;
    html += `<p class="muted small" style="margin-top:14px">Kennzahlen kommen alle 2 Stunden aus Buffer und wachsen noch einige Tage nach dem Posten. Aufrufe und Likes bei YouTube kommen zusätzlich aus dem öffentlichen Kanal-Feed (neueste 15 Videos), ältere behalten ihren letzten Stand. Follower-Zahlen liefert Buffer nicht.</p>`;
    view().innerHTML = html.replace("<!--stand-->", "");
    const btn = $("#soc-refresh");
    if (btn) btn.onclick = () => renderSocial(p);
    draws.forEach((f) => f());
  }

  async function socialToday(p) {
    try {
      const rows = await api(p, `social_posts?select=platform,status&day=eq.${todayIso()}`);
      if (!rows.length) return { text: "Noch nichts", hint: "Heute kein Eintrag", warn: true };
      const ok = rows.filter((r) => r.status === "sent" || r.status === "scheduled").length;
      const bad = rows.length - ok;
      return { text: bad ? `${ok} ✓ · ${bad} ✗` : `${ok} ✓`, hint: bad ? "Fehler – siehe Social Media" : "Alle Plattformen ok", warn: !!bad };
    } catch {
      return { text: "–", hint: "Historie noch nicht eingerichtet", warn: false };
    }
  }

  // ---------- Alle Nutzer (beide Apps)
  const usersState = { zitat: { q: "", sort: "last_sign_in_at" }, wort: { q: "", sort: "last_sign_in_at" } };
  const usersCache = { zitat: null, wort: null };

  async function renderAllUsers(p) {
    const title = `${PROJECTS[p].name} · Alle Nutzer`;
    view().innerHTML = head(title) + loading();
    if (!usersCache[p]) {
      try { usersCache[p] = await rpc(p, "admin_users"); }
      catch (e) { view().innerHTML = head(title) + `<div class="note-box">${/admin_users/.test(e.message) ? "Die Funktion fehlt noch – bitte das SQL ausführen." : esc(e.message)}</div>`; return; }
    }
    const all = usersCache[p];
    const st = usersState[p];
    const isZ = p === "zitat";
    const sorts = isZ
      ? [["last_sign_in_at", "Letzter Login"], ["last_seen", "Zuletzt aktiv"], ["created_at", "Registriert"], ["points", "Punkte"], ["active_days", "Aktive Tage"]]
      : [["last_sign_in_at", "Letzter Login"], ["last_seen", "Zuletzt aktiv"], ["created_at", "Registriert"], ["xp", "XP"], ["active_days", "Aktive Tage"]];
    const today = todayIso();
    const seenWithin = (n) => all.filter((u) => u.last_seen && daysBetween(u.last_seen, today) < n).length;
    const never = all.filter((u) => !u.last_sign_in_at).length;

    const draw = () => {
      const q = st.q.toLowerCase();
      const name = (u) => (isZ ? u.username : u.name) || "";
      const list = all
        .filter((u) => !q || name(u).toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q))
        .sort((a, b) => {
          const va = a[st.sort], vb = b[st.sort];
          if (va === vb) return 0;
          if (va === null || va === undefined) return 1;
          if (vb === null || vb === undefined) return -1;
          return va < vb ? 1 : -1;
        });
      const ago = (iso) => {
        if (!iso) return "nie";
        const d = daysBetween(iso.slice(0, 10), today);
        return d <= 0 ? "heute" : d === 1 ? "gestern" : `vor ${d} Tagen`;
      };
      $("#users-table").innerHTML = table([
        { label: "Nutzer", get: (u) => name(u) || "–" },
        { label: "E-Mail", get: (u) => u.email },
        { label: "Letzter Login", html: (u) => `${esc(u.last_sign_in_at ? dateTime(u.last_sign_in_at) : "nie")}<div class="muted small">${ago(u.last_sign_in_at)}</div>` },
        { label: "Zuletzt aktiv", html: (u) => `${esc(u.last_seen ? shortDay(u.last_seen) : "–")}<div class="muted small">${u.last_seen ? ago(u.last_seen) : ""}</div>` },
        { label: "Registriert", get: (u) => dateTime(u.created_at) },
        { label: "Aktive Tage", get: (u) => fmt(u.active_days), num: true },
        isZ ? { label: "Punkte", get: (u) => fmt(u.points), num: true } : { label: "XP", get: (u) => fmt(u.xp), num: true },
      ], list.slice(0, 500), "Keine Treffer.") + (list.length > 500 ? `<p class="muted small">Die ersten 500 von ${fmt(list.length)} – Suche verfeinern.</p>` : "");
      $("#users-count").textContent = `${fmt(list.length)} von ${fmt(all.length)}`;
    };

    view().innerHTML = head(title, `${fmt(all.length)} Nutzer ohne Bots`) + `
      <div class="tiles">
        ${tile("Aktiv heute", fmt(seenWithin(1)), "", `accent-${p}`)}
        ${tile("Aktiv in 7 Tagen", fmt(seenWithin(7)), "", `accent-${p}`)}
        ${tile("Aktiv in 30 Tagen", fmt(seenWithin(30)), "", `accent-${p}`)}
        ${tile("Länger als 30 Tage weg", fmt(all.length - seenWithin(30)), "oder nie aktiv", `accent-${p}`)}
        ${tile("Nie eingeloggt", fmt(never), "Konto angelegt, aber kein Login", `accent-${p}`)}
      </div>
      <div class="toolbar" style="margin:18px 0 10px">
        <input type="search" id="users-q" placeholder="Name oder E-Mail suchen …" value="${esc(st.q)}" style="max-width:320px">
        <label class="check" style="gap:8px">Sortieren nach
          <select id="users-sort" style="width:auto">${sorts.map(([k, l]) => `<option value="${k}"${k === st.sort ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <span class="muted small" id="users-count"></span>
      </div>
      <section class="panel" id="users-table"></section>`;
    $("#users-q").addEventListener("input", (e) => { st.q = e.target.value; draw(); });
    $("#users-sort").addEventListener("change", (e) => { st.sort = e.target.value; draw(); });
    draw();
  }

  // ---------------------------------------------------------------- Navigation

  const ROUTES = {
    overview: [null, renderOverview],
    "zitat-stats": ["zitat", renderZitatStats],
    "zitat-plan": ["zitat", renderZitatPlan],
    "zitat-suggestions": ["zitat", renderZitatSuggestions],
    "zitat-reports": ["zitat", renderZitatReports],
    "zitat-ideas": ["zitat", renderZitatIdeas],
    "zitat-users": ["zitat", renderZitatUsers],
    "wort-stats": ["wort", renderWortStats],
    "wort-plan": ["wort", renderWortPlan],
    "wort-suggestions": ["wort", renderWortSuggestions],
    "wort-ideas": ["wort", renderWortIdeas],
    "wort-users": ["wort", renderWortUsers],
    "zitat-social": ["zitat", () => renderSocial("zitat")],
    "wort-social": ["wort", () => renderSocial("wort")],
    "zitat-allusers": ["zitat", () => renderAllUsers("zitat")],
    "wort-allusers": ["wort", () => renderAllUsers("wort")],
  };

  async function route() {
    const key = ROUTES[location.hash.slice(1)] ? location.hash.slice(1) : "overview";
    document.querySelectorAll("#nav a").forEach((a) => a.toggleAttribute("aria-current", a.getAttribute("href") === `#${key}`));
    destroyCharts();
    const [p, render] = ROUTES[key];
    if (p && !loggedIn(p)) { view().innerHTML = notLoggedIn(p); bindRelogin(); return; }
    try { await render(); } catch (e) {
      if (/abgelaufen|Nicht angemeldet/.test(e.message)) return showLogin(e.message);
      view().innerHTML += `<div class="note-box">${esc(e.message)}</div>`;
    }
    view().focus({ preventScroll: true });
  }

  function bindRelogin() {
    view().querySelector("[data-relogin]")?.addEventListener("click", (e) => { e.preventDefault(); showLogin(); });
  }

  function showApp() {
    $("#login").hidden = true;
    $("#app").hidden = false;
    document.querySelectorAll(".nav-group").forEach((g) => g.classList.toggle("disabled", !loggedIn(g.dataset.project)));
    route();
    loadStats("zitat");
    loadStats("wort");
  }

  function showLogin(msg = "") {
    $("#app").hidden = true;
    $("#login").hidden = false;
    $("#login-error").textContent = msg;
  }

  // ---------------------------------------------------------------- Start

  $("#same").addEventListener("change", (e) => { $("#cred-wort").hidden = e.target.checked; });

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const same = $("#same").checked;
    const creds = {
      zitat: { email: f.get("zitat-email").trim(), password: f.get("zitat-password") },
      wort: same ? null : { email: f.get("wort-email").trim(), password: f.get("wort-password") },
    };
    creds.wort = creds.wort && creds.wort.email ? creds.wort : creds.zitat;
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    $("#login-error").textContent = "";
    const errors = [];
    await Promise.all(Object.keys(PROJECTS).map(async (p) => {
      try {
        await authCall(p, "password", creds[p]);
        await loadStats(p, true);
        if (statsError[p] && /Admin/i.test(statsError[p])) { saveSession(p, null); errors.push(`${PROJECTS[p].name}: kein Admin-Konto`); }
      } catch (err) {
        errors.push(`${PROJECTS[p].name}: ${err.message}`);
      }
    }));
    btn.disabled = false;
    e.target.querySelectorAll("input[type=password]").forEach((i) => { i.value = ""; });
    if (loggedIn("zitat") || loggedIn("wort")) {
      if (errors.length) toast(errors.join(" · "), true);
      showApp();
    } else {
      $("#login-error").textContent = errors.join(" · ");
    }
  });

  $("#logout").addEventListener("click", () => {
    for (const p of Object.keys(PROJECTS)) saveSession(p, null);
    stats.zitat = stats.wort = null;
    location.hash = "";
    showLogin();
  });

  $("#refresh").addEventListener("click", async () => {
    stats.zitat = stats.wort = null;
    await route();
    toast("Aktualisiert");
  });

  window.addEventListener("hashchange", () => { if (!$("#app").hidden) route(); });

  if (loggedIn("zitat") || loggedIn("wort")) showApp();
  else showLogin();
})();
