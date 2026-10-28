// Lädt Wort und Zitat des Tages direkt aus den Datenbanken der beiden Apps.
(() => {
  const CFG = window.WDT_CONFIG;
  const DAYS = 30;
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

  // Heute in Berlin, unabhängig von der Zeitzone des Besuchers
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

  const parse = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const shiftIso = (iso, days) => { const t = parse(iso); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10); };
  const longDate = (iso) => { const t = parse(iso); return `${WEEKDAYS[t.getUTCDay()]}, ${t.getUTCDate()}. ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };
  const shortDate = (iso) => { const t = parse(iso); return `${t.getUTCDate()}. ${MONTHS[t.getUTCMonth()]}`; };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function sb({ url, key }, path, body) {
    const headers = { apikey: key, "Content-Type": "application/json" };
    if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(`${url}/rest/v1/${path}`, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }

  const loadWords = () => sb(CFG.wort,
    `words?select=wort,lautschrift,wortart,definition,beispielsatz,synonyme,datum` +
    `&and=(datum.lte.${todayIso},datum.gt.${shiftIso(todayIso, -DAYS)})&order=datum.desc`);
  const loadQuotes = () => sb(CFG.zitat, "rpc/web_quotes", { p_days: DAYS });

  // ---------- Bausteine

  function wordBody(w, compact) {
    const meta = [w.lautschrift && esc(w.lautschrift), w.wortart && `<i>${esc(w.wortart)}</i>`].filter(Boolean).join(" · ");
    const syn = (w.synonyme || []).filter(Boolean);
    return `
      <h3 class="word">${esc(w.wort)}</h3>
      ${meta ? `<div class="word-meta">${meta}</div>` : ""}
      <p class="definition">${esc(w.definition)}</p>
      ${w.beispielsatz && !compact ? `<p class="example">„${esc(w.beispielsatz)}“</p>` : ""}
      ${syn.length && !compact ? `<div class="chips">${syn.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>` : ""}`;
  }

  function quoteBody(q, compact) {
    const src = [q.source, q.year].filter(Boolean).map(esc).join(" · ");
    return `
      ${compact ? "" : `<div class="qmark" aria-hidden="true">”</div>`}
      <blockquote class="quote">${esc(q.text)}</blockquote>
      <div class="author">— ${esc(q.author)}</div>
      ${src ? `<div class="source">${src}</div>` : ""}
      ${q.explanation && !compact ? `<div class="explain"><span class="kicker">Zum Zitat</span>${esc(q.explanation)}</div>` : ""}`;
  }

  const failed = (what) => `<p class="skeleton">${what} konnte gerade nicht geladen werden. Bitte später erneut versuchen.</p>`;

  // ---------- Startseite

  async function home() {
    document.getElementById("today-date").textContent = longDate(todayIso);
    const wEl = document.getElementById("wort-body");
    const qEl = document.getElementById("zitat-body");
    const [words, quotes] = await Promise.allSettled([loadWords(), loadQuotes()]);

    if (words.status === "fulfilled" && words.value.length) {
      const w = words.value[0];
      document.getElementById("wort-date").textContent = shortDate(w.datum);
      wEl.innerHTML = wordBody(w);
    } else wEl.innerHTML = failed("Das Wort des Tages");

    if (quotes.status === "fulfilled" && quotes.value.length) {
      const q = quotes.value[0];
      document.getElementById("zitat-date").textContent = shortDate(q.day);
      qEl.innerHTML = quoteBody(q);
    } else qEl.innerHTML = failed("Das Zitat des Tages");
  }

  // ---------- Archiv

  async function archive() {
    const listEl = document.getElementById("list");
    const tabs = document.querySelectorAll(".tabs a");
    const show = async (kind) => {
      tabs.forEach((t) => t.toggleAttribute("aria-current", t.dataset.kind === kind));
      listEl.innerHTML = `<p class="skeleton">Wird geladen …</p>`;
      try {
        if (kind === "woerter") {
          const words = await loadWords();
          listEl.innerHTML = words.map((w) => `
            <article class="card wort-card entry"><time datetime="${w.datum}">${shortDate(w.datum)}</time><div>${wordBody(w, true)}</div></article>`).join("")
            || `<p class="skeleton">Noch keine Wörter.</p>`;
        } else {
          const quotes = await loadQuotes();
          listEl.innerHTML = quotes.map((q) => `
            <article class="card zitat-card entry"><time datetime="${q.day}">${shortDate(q.day)}</time><div>${quoteBody(q, true)}</div></article>`).join("")
            || `<p class="skeleton">Noch keine Zitate.</p>`;
        }
      } catch {
        listEl.innerHTML = failed("Das Archiv");
      }
    };
    tabs.forEach((t) => t.addEventListener("click", (e) => {
      e.preventDefault();
      history.replaceState(null, "", `#${t.dataset.kind}`);
      show(t.dataset.kind);
    }));
    show(location.hash === "#zitate" ? "zitate" : "woerter");
  }

  document.body.dataset.page === "archiv" ? archive() : home();
})();
