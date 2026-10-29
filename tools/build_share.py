"""
Erzeugt teilbare Einzelseiten für jedes erschienene Wort und Zitat – mit eigenem Vorschaubild
für WhatsApp, Instagram, Facebook usw. Läuft täglich als GitHub-Ablauf und committet das Ergebnis.

  wort/<wort>/index.html + og.png       z. B. wortdestages.eu/wort/chiffre/
  zitat/<datum>/index.html + og.png     z. B. wortdestages.eu/zitat/2026-10-29/
  sitemap.xml

Die Daten kommen mit den öffentlichen Schlüsseln aus config.js – also nur, was ohnehin öffentlich ist
(Wörter bis heute, Zitate der letzten 30 Tage). Einmal erzeugte Seiten bleiben bestehen.
"""

import datetime as dt
import html
import json
import os
import re
import sys
import textwrap
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://wortdestages.eu"
TODAY = dt.datetime.now(ZoneInfo("Europe/Berlin")).date()
MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]
WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
STORE = {"wort": "https://play.google.com/store/apps/details?id=wort.des.tages",
         "zitat": "https://play.google.com/store/apps/details?id=zitat.des.tages"}
FONT_DIRS = ["/usr/share/fonts/truetype/noto", "/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF", "C:/Windows/Fonts"]


def config():
    """Öffentliche Schlüssel aus config.js lesen (dieselben wie auf der Webseite)."""
    src = (ROOT / "config.js").read_text(encoding="utf-8")
    out = {}
    for name in ("wort", "zitat"):
        block = re.search(name + r"\s*:\s*\{(.*?)\}", src, re.S).group(1)
        out[name] = {k: re.search(k + r"\s*:\s*[\"']([^\"']+)", block).group(1) for k in ("url", "key")}
    return out


def sb(cfg, path, body=None):
    h = {"apikey": cfg["key"], "Content-Type": "application/json"}
    if cfg["key"].startswith("eyJ"):
        h["Authorization"] = f"Bearer {cfg['key']}"
    url = f"{cfg['url'].rstrip('/')}/rest/v1/{path}"
    r = requests.post(url, headers=h, json=body, timeout=30) if body is not None else requests.get(url, headers=h, timeout=30)
    r.raise_for_status()
    return r.json()


def slug(s):
    s = s.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "wort"


def long_date(iso):
    d = dt.date.fromisoformat(iso)
    return f"{WEEKDAYS[d.weekday()]}, {d.day}. {MONTHS[d.month - 1]} {d.year}"


def esc(s):
    return html.escape(str(s or ""), quote=True)


# ---------------------------------------------------------------- Vorschaubild 1200 × 630

def font(names, size):
    for d in FONT_DIRS:
        for n in names:
            p = Path(d) / n
            if p.exists():
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default(size)


SERIF = ["NotoSerif-Regular.ttf", "georgia.ttf"]
SERIF_BOLD = ["NotoSerif-Bold.ttf", "georgiab.ttf"]
SANS = ["Roboto-Medium.ttf", "NotoSans-Medium.ttf", "segoeui.ttf"]


def fit(draw, text, names, max_w, max_h, start, minimum, spacing=1.25):
    """Größte Schrift, bei der der umbrochene Text in den Kasten passt."""
    for size in range(start, minimum - 1, -2):
        f = font(names, size)
        avg = draw.textlength("abcdefghijklmnopqrstuvwxyz", font=f) / 26
        lines = textwrap.wrap(text, width=max(8, int(max_w / avg)))
        if all(draw.textlength(l, font=f) <= max_w for l in lines) and len(lines) * size * spacing <= max_h:
            return f, lines, size
    f = font(names, minimum)
    avg = draw.textlength("abcdefghijklmnopqrstuvwxyz", font=f) / 26
    lines = textwrap.wrap(text, width=max(8, int(max_w / avg)))
    keep = max(1, int(max_h / (minimum * spacing)))
    if len(lines) > keep:
        lines = lines[:keep]
        lines[-1] = lines[-1].rstrip(" ,.;:") + " …"
    return f, lines, minimum


def og_wort(w, path):
    img = Image.new("RGB", (1200, 630), "#000000")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 1200, 8], fill="#22d3d8")
    d.text((80, 70), "WORT DES TAGES", font=font(SANS, 30), fill="#22d3d8")
    f, lines, size = fit(d, w["wort"], SERIF_BOLD, 1040, 150, 120, 60)
    y = 130
    for l in lines:
        d.text((80, y), l, font=f, fill="#fafafa")
        y += int(size * 1.15)
    meta = " · ".join(x for x in (w.get("lautschrift"), w.get("wortart")) if x)
    if meta:
        d.text((82, y + 18), meta, font=font(SERIF, 30), fill="#a3a3a3")
        y += 70
    f2, lines2, s2 = fit(d, w.get("definition") or "", SERIF, 1040, 520 - y, 40, 26)
    y += 16
    for l in lines2:
        d.text((80, y), l, font=f2, fill="#d4d4d4")
        y += int(s2 * 1.3)
    d.text((80, 560), "wortdestages.eu", font=font(SANS, 26), fill="#71717a")
    img.save(path, optimize=True)


def og_zitat(q, path):
    img = Image.new("RGB", (1200, 630), "#faf6f1")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 1200, 8], fill="#ae3049")
    d.text((80, 70), "ZITAT DES TAGES", font=font(SANS, 30), fill="#ae3049")
    d.text((1040, 20), "”", font=font(SERIF_BOLD, 220), fill="#e39aa8")
    f, lines, size = fit(d, f"„{q['text']}“", SERIF, 1040, 330, 64, 30, 1.3)
    y = 140
    for l in lines:
        d.text((80, y), l, font=f, fill="#1e1814")
        y += int(size * 1.3)
    d.text((80, y + 20), f"— {q['author']}", font=font(SERIF, 34), fill="#ae3049")
    d.text((80, 560), "wortdestages.eu", font=font(SANS, 26), fill="#9f9388")
    img.save(path, optimize=True)


# ---------------------------------------------------------------- Seiten

def page(kind, url, title, description, date_iso, body, extra_head=""):
    other = "zitat" if kind == "wort" else "wort"
    app = "Wort des Tages" if kind == "wort" else "Zitat des Tages"
    icon = "wort-icon.webp" if kind == "wort" else "zitat-icon.png"
    return f"""<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Wort &amp; Zitat des Tages">
<meta property="og:locale" content="de_DE">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:image" content="{url}og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0c0c0d">
<link rel="icon" href="../../img/wort-icon.webp" type="image/webp">
<link rel="stylesheet" href="../../style.css">
{extra_head}</head>
<body data-page="share">
<header class="top"><div class="wrap">
  <a class="brand" href="../../index.html"><span class="icons"><img src="../../img/wort-icon.webp" alt=""><img src="../../img/zitat-icon.png" alt=""></span>Wort &amp; Zitat des Tages</a>
  <nav class="nav"><a href="../../index.html">Heute</a><a href="../../archiv.html">Archiv</a><a href="../../apps.html">Apps</a></nav>
</div></header>
<main>
<section class="wrap share">
  <article class="card {kind}-card">
    <div class="card-head">
      <a class="app" href="../../apps.html#{kind}"><img src="../../img/{icon}" alt=""><span class="kicker">{app}</span></a>
      <time datetime="{date_iso}">{long_date(date_iso)}</time>
    </div>
    {body}
  </article>
  <div class="share-actions">
    <button class="btn" type="button" data-share>Teilen</button>
    <a class="btn ghost" href="{STORE[kind]}">Jeden Tag neu in der App „{app}“</a>
  </div>
  <p class="share-more"><a href="../../index.html">Heutiges Wort und Zitat ansehen →</a> · <a href="../../archiv.html#{'woerter' if kind == 'wort' else 'zitate'}">Archiv</a></p>
</section>
</main>
<footer class="foot"><div class="wrap">
  <span>© {TODAY.year} Wort &amp; Zitat des Tages</span>
  <nav>
    <a href="../../apps.html">Apps</a>
    <a href="../../impressum.html">Impressum</a>
    <a href="../../datenschutz.html">Datenschutz</a>
  </nav>
</div></footer>
<script>
document.querySelector("[data-share]").addEventListener("click", async (e) => {{
  const data = {{ title: document.title, url: location.href }};
  try {{
    if (navigator.share) await navigator.share(data);
    else {{ await navigator.clipboard.writeText(location.href); e.target.textContent = "Link kopiert"; }}
  }} catch {{}}
}});
</script>
</body>
</html>
"""


def wort_page(w):
    s = slug(w["wort"])
    url = f"{SITE}/wort/{s}/"
    meta = " · ".join(x for x in (esc(w.get("lautschrift")), f"<i>{esc(w['wortart'])}</i>" if w.get("wortart") else "") if x)
    syn = [x for x in (w.get("synonyme") or []) if x]
    body = f"""<h1 class="word">{esc(w['wort'])}</h1>
    {f'<div class="word-meta">{meta}</div>' if meta else ''}
    <p class="definition">{esc(w.get('definition'))}</p>
    {f'<p class="example">„{esc(w["beispielsatz"])}“</p>' if w.get('beispielsatz') else ''}
    {'<div class="chips">' + ''.join(f'<span class="chip">{esc(x)}</span>' for x in syn) + '</div>' if syn else ''}"""
    desc = f"{w['wort']}: {w.get('definition') or ''}"[:200]
    ld = {"@context": "https://schema.org", "@type": "DefinedTerm", "name": w["wort"], "description": w.get("definition") or "",
          "inDefinedTermSet": f"{SITE}/archiv.html#woerter", "url": url}
    head = f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>\n'
    d = ROOT / "wort" / s
    d.mkdir(parents=True, exist_ok=True)
    (d / "index.html").write_text(page("wort", url, f"{w['wort']} – Wort des Tages", desc, w["datum"], body, head), encoding="utf-8")
    og_wort(w, d / "og.png")
    return url, w["datum"]


def zitat_page(q):
    url = f"{SITE}/zitat/{q['day']}/"
    src = " · ".join(esc(x) for x in (q.get("source"), q.get("year")) if x)
    body = f"""<div class="qmark" aria-hidden="true">”</div>
    <blockquote class="quote">{esc(q['text'])}</blockquote>
    <div class="author">— {esc(q['author'])}</div>
    {f'<div class="source">{src}</div>' if src else ''}
    {f'<div class="explain"><span class="kicker">Zum Zitat</span>{esc(q["explanation"])}</div>' if q.get('explanation') else ''}"""
    desc = f"„{q['text']}“ – {q['author']}"[:200]
    ld = {"@context": "https://schema.org", "@type": "Quotation", "text": q["text"],
          "spokenByCharacter": {"@type": "Person", "name": q["author"]}, "url": url}
    head = f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>\n'
    d = ROOT / "zitat" / q["day"]
    d.mkdir(parents=True, exist_ok=True)
    title = f"„{q['text'][:60]}{'…' if len(q['text']) > 60 else ''}“ – {q['author']}"
    (d / "index.html").write_text(page("zitat", url, title, desc, q["day"], body, head), encoding="utf-8")
    og_zitat(q, d / "og.png")
    return url, q["day"]


def sitemap():
    urls = [(f"{SITE}/", TODAY.isoformat()), (f"{SITE}/archiv.html", TODAY.isoformat()), (f"{SITE}/apps.html", None)]
    for kind in ("wort", "zitat"):
        for f in sorted((ROOT / kind).glob("*/index.html")):
            m = re.search(r'<time datetime="([\d-]+)"', f.read_text(encoding="utf-8"))
            urls.append((f"{SITE}/{kind}/{f.parent.name}/", m.group(1) if m else None))
    items = "\n".join(f"  <url><loc>{u}</loc>{f'<lastmod>{d}</lastmod>' if d else ''}</url>" for u, d in urls)
    (ROOT / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{items}\n</urlset>\n', encoding="utf-8")


def main():
    cfg = config()
    errors = 0
    try:
        words = sb(cfg["wort"], f"words?select=wort,lautschrift,wortart,definition,beispielsatz,synonyme,datum&datum=lte.{TODAY}&order=datum.asc")
        for w in words:  # aufsteigend: kommt ein Wort zweimal vor, gewinnt das neuere Datum
            if w.get("wort") and w.get("datum"):
                wort_page(w)
        print(f"{len(words)} Wort-Seiten")
    except Exception as e:
        errors += 1
        print("Wörter fehlgeschlagen:", e)
    try:
        quotes = sb(cfg["zitat"], "rpc/web_quotes", {"p_days": 30})
        for q in quotes:
            zitat_page(q)
        print(f"{len(quotes)} Zitat-Seiten")
    except Exception as e:
        errors += 1
        print("Zitate fehlgeschlagen:", e)
    sitemap()
    if errors == 2:
        sys.exit(1)


if __name__ == "__main__":
    main()
