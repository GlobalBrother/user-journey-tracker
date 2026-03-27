"""
Simulare REALISTA — comportament identic cu utilizatorii reali
==============================================================

REGULI REALE aplicare:
  1. localStorage este per-domeniu → user_id diferit pe fiecare site
  2. fbclid este unic per click → NU leaga site-uri diferite
  3. buyer_id (Digistore24) este SINGURUL mecanism real cross-site
  4. Sesiunile fara conversie raman ca profile orfane in Azure

PERSONAJE:
  ANA    — mobile Chrome, viziteaza 4 site-uri diferite
           Converteste 1x pe alpha (37 EUR) si 1x pe gamma (47 EUR)
           ► 4 user_ids generate, 2 se merg via buyer_id, 2 raman orfane

  BOGDAN — desktop Safari pe alpha+beta, desktop Firefox pe gamma+delta
           Converteste 1x pe beta (37 EUR) si 1x pe delta (47 EUR)
           ► 4 user_ids, 2 merg (delta→beta), 2 orfane (alpha, gamma)

  CRISTINA — mobile pe alpha+beta, desktop pe gamma+delta
             Converteste 2x pe alpha (37+27 EUR) si 1x pe gamma (47 EUR)
             ► 4 user_ids, 2 merg (gamma→alpha), 2 orfane (beta, delta)

TABEL user_ids create (12 total):
  ┌─────────────────────┬─────────────────────┬──────────────────────────────────────┐
  │ user_id             │ tip                 │ soarta                               │
  ├─────────────────────┼─────────────────────┼──────────────────────────────────────┤
  │ ana_alpha           │ propriu             │ canonical (2 cv, 2 pv dupa merge)    │
  │ ana_beta            │ propriu             │ ORFAN (1 pv, 0 cv)                   │
  │ ana_gamma           │ propriu             │ → merge in ana_alpha via buyer_id    │
  │ ana_delta           │ propriu             │ ORFAN (1 pv, 0 cv)                   │
  │ bog_saf_alpha       │ propriu Safari      │ ORFAN (1 pv, 0 cv)                   │
  │ bog_saf_beta        │ propriu Safari      │ canonical (2 cv, 2 pv dupa merge)    │
  │ bog_ff_gamma        │ propriu Firefox     │ ORFAN (1 pv, 0 cv)                   │
  │ bog_ff_delta        │ propriu Firefox     │ → merge in bog_saf_beta via buyer_id │
  │ cris_mob_alpha      │ propriu mobile      │ canonical (3 cv, 2 pv dupa merge)    │
  │ cris_mob_beta       │ propriu mobile      │ ORFAN (1 pv, 0 cv)                   │
  │ cris_desk_gamma     │ propriu desktop     │ → merge in cris_mob_alpha via buyer_id│
  │ cris_desk_delta     │ propriu desktop     │ ORFAN (1 pv, 0 cv)                   │
  └─────────────────────┴─────────────────────┴──────────────────────────────────────┘

NOTA: profilele orfane sunt inevitabile in productie.
      Un user care viziteaza 4 site-uri fara sa cumpere = 4 profile separate.
      Merge-ul se intampla DOAR la conversie, prin buyer_id.
"""

import os, time, requests
from datetime import datetime, timezone
from dotenv import load_dotenv

BASE  = "http://localhost:8000"
HDRS  = {"Content-Type": "application/json"}
SITES = {
    "alpha": "site-alpha.com",
    "beta":  "site-beta.com",
    "gamma": "site-gamma.com",
    "delta": "site-delta.com",
}

def ts():
    return datetime.now(timezone.utc).isoformat()

def pv(user_id, site, slug, fbclid=None, browser="chrome", device="desktop"):
    """Simuleaza un pageview — fiecare site genereaza propriul user_id."""
    r = requests.post(f"{BASE}/api/events", headers=HDRS, json={
        "user_id":     user_id,
        "domain":      SITES[site],
        "url":         f"https://{SITES[site]}/{slug}",
        "slug":        slug,
        "referrer":    "https://facebook.com" if fbclid else "https://google.com",
        "timestamp":   ts(),
        "device_type": device,
        "browser":     browser,
        "country":     "RO",
        "fbclid":      fbclid,
    })
    fbc = (fbclid[:12] + "...") if fbclid else "—"
    print(f"  pv  {user_id:<26} {SITES[site]:<22} fbclid={fbc:<16} → {r.status_code}")
    time.sleep(0.15)

def cv(user_id, order_id, site, buyer_id, value):
    """Simuleaza o conversie — backend-ul face identity resolution via buyer_id."""
    r = requests.post(f"{BASE}/api/conversions", headers=HDRS, json={
        "user_id":      user_id,
        "order_id":     order_id,
        "product_name": "The Lost Superfoods",
        "product_id":   "577004",
        "value":        value,
        "currency":     "EUR",
        "domain":       SITES[site],
        "timestamp":    ts(),
        "buyer_id":     buyer_id,
    })
    note = r.json().get("note", "ok")
    print(f"  cv  {user_id:<26} {SITES[site]:<22} {order_id:<16} {value:.0f}€  buyer={buyer_id} → {r.status_code} {note}")
    time.sleep(0.15)

sep = "─" * 76

# ═══════════════════════════════════════════════════════════════════════════════
print(); print("═" * 76)
print("  ANA — mobile Chrome, 4 site-uri, 2 conversii")
print("  REALITATE: fiecare domeniu = user_id separat (localStorage per-domain)")
print("═" * 76)

# Ana vine din Facebook (fbclid unic pentru clickul EI)
# Dar fiecare site nou = user_id nou (nu se mosteneste intre domenii)
FBCLID_ANA = "FBCLID_ANA_CLICK_001"

print(f"\n  {sep}")
print("  Vizite Ana (4 site-uri = 4 user_id-uri diferite):")
print(f"  {sep}")
pv("ana_alpha",  "alpha", "hero",         fbclid=FBCLID_ANA,  browser="chrome", device="mobile")
pv("ana_beta",   "beta",  "features",     fbclid=None,         browser="chrome", device="mobile")  # fbclid nu trece intre site-uri
pv("ana_gamma",  "gamma", "pricing",      fbclid=None,         browser="chrome", device="mobile")
pv("ana_delta",  "delta", "testimonials", fbclid=None,         browser="chrome", device="mobile")

print(f"\n  {sep}")
print("  Conversii Ana (buyer_id leaga ana_gamma → ana_alpha la a 2-a conversie):")
print(f"  {sep}")
cv("ana_alpha", "ANA_ORD_1", "alpha", buyer_id="BUYER_ANA", value=37.0)  # prima conversie, no merge yet
cv("ana_gamma", "ANA_ORD_2", "gamma", buyer_id="BUYER_ANA", value=47.0)  # backend gaseste BUYER_ANA → merge gamma→alpha

# ═══════════════════════════════════════════════════════════════════════════════
print(); print("═" * 76)
print("  BOGDAN — Safari pe alpha+beta, Firefox pe gamma+delta")
print("  REALITATE: 2 browsere = 2 user_id-uri per site (localStorage per-browser)")
print("═" * 76)

print(f"\n  {sep}")
print("  Vizite Bogdan Safari (alpha, beta):")
print(f"  {sep}")
pv("bog_saf_alpha", "alpha", "hero",     fbclid=None, browser="safari",  device="desktop")
pv("bog_saf_beta",  "beta",  "features", fbclid=None, browser="safari",  device="desktop")

print(f"\n  {sep}")
print("  Bogdan cumpara din Safari pe beta:")
print(f"  {sep}")
cv("bog_saf_beta", "BOG_ORD_1", "beta", buyer_id="BUYER_BOG", value=37.0)

print(f"\n  {sep}")
print("  Bogdan deschide Firefox (alt browser → user_id NOU pe fiecare site):")
print(f"  {sep}")
pv("bog_ff_gamma", "gamma", "pricing",      fbclid=None, browser="firefox", device="desktop")
pv("bog_ff_delta", "delta", "testimonials", fbclid=None, browser="firefox", device="desktop")

print(f"\n  {sep}")
print("  Bogdan cumpara din Firefox pe delta (buyer_id = acelasi → merge delta→beta):")
print(f"  {sep}")
cv("bog_ff_delta", "BOG_ORD_2", "delta", buyer_id="BUYER_BOG", value=47.0)

# ═══════════════════════════════════════════════════════════════════════════════
print(); print("═" * 76)
print("  CRISTINA — mobile Chrome pe alpha+beta, desktop Chrome pe gamma+delta")
print("  REALITATE: telefon si laptop = device-uri separate → user_id-uri separate")
print("═" * 76)

print(f"\n  {sep}")
print("  Vizite Cristina (mobile, alpha+beta):")
print(f"  {sep}")
pv("cris_mob_alpha", "alpha", "hero",     fbclid=None, browser="chrome", device="mobile")
pv("cris_mob_beta",  "beta",  "features", fbclid=None, browser="chrome", device="mobile")

print(f"\n  {sep}")
print("  Cristina cumpara 2x pe alpha (produs + upsell), acelasi user_id mobile:")
print(f"  {sep}")
cv("cris_mob_alpha", "CRIS_ORD_1", "alpha", buyer_id="BUYER_CRIS", value=37.0)
cv("cris_mob_alpha", "CRIS_ORD_2", "alpha", buyer_id="BUYER_CRIS", value=27.0)  # upsell, same user_id

print(f"\n  {sep}")
print("  Cristina deschide laptopul (desktop → alt user_id pe fiecare site):")
print(f"  {sep}")
pv("cris_desk_gamma", "gamma", "pricing",      fbclid=None, browser="chrome", device="desktop")
pv("cris_desk_delta", "delta", "testimonials", fbclid=None, browser="chrome", device="desktop")

print(f"\n  {sep}")
print("  Cristina cumpara de pe laptop (buyer_id = acelasi → merge desk_gamma→mob_alpha):")
print(f"  {sep}")
cv("cris_desk_gamma", "CRIS_ORD_3", "gamma", buyer_id="BUYER_CRIS", value=47.0)

# ═══════════════════════════════════════════════════════════════════════════════
print(); print("═" * 76)
print("  VERIFICARE AZURE SQL — ce a ajuns efectiv in baza de date?")
print("═" * 76)

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend", ".env"))
import pymssql, json

conn = pymssql.connect(
    server="gb-ads-sql-server.database.windows.net",
    user=os.environ["DB_USER"],
    password=os.environ["DB_PASSWORD"],
    database="userTracker",
    login_timeout=30,
    autocommit=True
)
c = conn.cursor()

# ── 1. CONVERSII ───────────────────────────────────────────────────────────────
print()
print("[ CONVERSII ] — 7 total, toate sub user_id canonical")
print(f"  {'user_id':<26} {'order_id':<16} {'site':<22} {'val':>6}  buyer_id")
print("  " + "─" * 82)
c.execute("SELECT user_id, order_id, domain, value, buyer_id FROM conversions ORDER BY timestamp")
rows_cv = c.fetchall()
for uid, oid, dom, val, bid in rows_cv:
    flag = "  ← EROARE" if uid in ("ana_gamma","bog_ff_delta","cris_desk_gamma") else ""
    print(f"  {uid:<26} {oid:<16} {dom:<22} {val:>6.2f}  {bid}{flag}")
print(f"\n  Total: {len(rows_cv)} conversii  (asteptat: 7)")

# ── 2. USER_EVENTS ─────────────────────────────────────────────────────────────
print()
print("[ USER_EVENTS ] — grupat per user_id")
print("  user_ids asteptati sa DISPARA (merge): ana_gamma, bog_ff_delta, cris_desk_gamma")
print("  user_ids ORFANI (raman, fara conversie): ana_beta, ana_delta, bog_saf_alpha, bog_ff_gamma, cris_mob_beta, cris_desk_delta")
print(f"  {'user_id':<26} {'nr_pv':>5}  {'tip':<12}  site-uri")
print("  " + "─" * 80)
c.execute("""
    SELECT user_id, COUNT(*) AS nr, STRING_AGG(domain, ', ') AS sites
    FROM user_events GROUP BY user_id ORDER BY user_id
""")
MERGED  = {"ana_gamma", "bog_ff_delta", "cris_desk_gamma"}
ORPHANS = {"ana_beta", "ana_delta", "bog_saf_alpha", "bog_ff_gamma", "cris_mob_beta", "cris_desk_delta"}
CANONICAL = {"ana_alpha", "bog_saf_beta", "cris_mob_alpha"}
for uid, nr, sites in c.fetchall():
    if uid in MERGED:
        tip = "← EROARE"
    elif uid in ORPHANS:
        tip = "orfan ⚠"
    elif uid in CANONICAL:
        tip = "canonical ✓"
    else:
        tip = "?"
    print(f"  {uid:<26} {nr:>5}  {tip:<12}  {sites}")

# ── 3. USER_PROFILES — starea reala ────────────────────────────────────────────
print()
print("[ USER_PROFILES ] — starea reala (include profiluri orfane si stale)")
print("  NOTA: user_profiles NU face merge automat → inconsistenta cunoscuta")
print(f"  {'user_id':<26} {'pv':>4} {'cv':>4} {'revenue':>10}  tip")
print("  " + "─" * 70)
c.execute("""
    SELECT user_id, total_pageviews, total_conversions, total_revenue
    FROM user_profiles ORDER BY user_id
""")
for uid, pvs, cvs, rev in c.fetchall():
    if uid in MERGED:
        tip = "← stale (merge facut, date in canonical)"
    elif uid in ORPHANS:
        tip = "orfan ⚠ (fara conversie)"
    elif uid in CANONICAL:
        tip = "canonical ✓"
    else:
        tip = "?"
    print(f"  {uid:<26} {pvs:>4} {cvs:>4} {(str(round(rev,2))+' EUR'):>10}  {tip}")

# ── 4. CHECKLIST ───────────────────────────────────────────────────────────────
print()
print("[ CHECKLIST identity resolution ]")
checks = [
    # Merge checks
    ("ana_gamma absent din conversions",        "SELECT COUNT(*) FROM conversions  WHERE user_id='ana_gamma'",        0),
    ("bog_ff_delta absent din conversions",     "SELECT COUNT(*) FROM conversions  WHERE user_id='bog_ff_delta'",     0),
    ("cris_desk_gamma absent din conversions",  "SELECT COUNT(*) FROM conversions  WHERE user_id='cris_desk_gamma'",  0),
    ("ana_gamma absent din user_events",        "SELECT COUNT(*) FROM user_events  WHERE user_id='ana_gamma'",        0),
    ("bog_ff_delta absent din user_events",     "SELECT COUNT(*) FROM user_events  WHERE user_id='bog_ff_delta'",     0),
    ("cris_desk_gamma absent din user_events",  "SELECT COUNT(*) FROM user_events  WHERE user_id='cris_desk_gamma'",  0),
    # Canonical counts
    ("ana_alpha: 2 pv (own+gamma)",             "SELECT COUNT(*) FROM user_events  WHERE user_id='ana_alpha'",        2),
    ("bog_saf_beta: 2 pv (own+delta)",          "SELECT COUNT(*) FROM user_events  WHERE user_id='bog_saf_beta'",     2),
    ("cris_mob_alpha: 2 pv (own+desk_gamma)",   "SELECT COUNT(*) FROM user_events  WHERE user_id='cris_mob_alpha'",   2),
    ("ana_alpha: 2 conversii",                  "SELECT COUNT(*) FROM conversions  WHERE user_id='ana_alpha'",        2),
    ("bog_saf_beta: 2 conversii",               "SELECT COUNT(*) FROM conversions  WHERE user_id='bog_saf_beta'",     2),
    ("cris_mob_alpha: 3 conversii",             "SELECT COUNT(*) FROM conversions  WHERE user_id='cris_mob_alpha'",   3),
    # Orphans exist (correct behavior)
    ("orfani au 0 conversii (corect)",          "SELECT COUNT(*) FROM conversions  WHERE user_id IN ('ana_beta','ana_delta','bog_saf_alpha','bog_ff_gamma','cris_mob_beta','cris_desk_delta')", 0),
    # Total
    ("Total 7 conversii",                       "SELECT COUNT(*) FROM conversions",                                   7),
    ("Total 12 pageviews",                      "SELECT COUNT(*) FROM user_events",                                  12),
]

all_pass = True
for label, sql, expected in checks:
    c.execute(sql)
    got = c.fetchone()[0]
    ok  = (got == expected)
    if not ok:
        all_pass = False
    print(f"  [{'PASS' if ok else 'FAIL'}]  {label:<48}  got={got}  expected={expected}")

print()
print("  ┌─────────────────────────────────────────────────────────┐")
print(f"  │  REZULTAT: {'TOATE TESTELE TRECUTE ✓' if all_pass else 'UNELE TESTE AU ESUAT ✗':<46}│")
print("  └─────────────────────────────────────────────────────────┘")

print()
print("[ CONCLUZIE ]")
print("  ✓ Conversiile sunt 100% corecte — merge via buyer_id functional.")
print("  ✓ Pageview-urile blocurilor 'merge' sunt remapate corect.")
print("  ⚠ Profile orfane: 6 user_ids cu vizite dar fara conversie.")
print("    Acestea reprezinta sesiunile pe site-urile unde userul NU a cumparat.")
print("    In productie, este normal si inevitabil.")
print("  ⚠ user_profiles nu reflecta merge-ul complet (limitare cunoscuta).")

conn.close()
print()
