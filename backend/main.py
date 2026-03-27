"""
AppCore Analytics - FastAPI Backend
Azure SQL Database (gb-ads-sql-server.database.windows.net / userTracker)

Endpoints:
  POST /api/events       → pageview tracking
  POST /api/conversions  → purchase/conversion tracking
  POST /api/actions      → custom events (view_content, checkout_initiated, etc.)
  GET  /api/p.gif        → image pixel fallback (ad blocker bypass)
  POST /api/b            → beacon API fallback
  GET  /api/journey/{id} → full user journey for dashboard
  GET  /health           → DB connectivity check
"""

from fastapi import FastAPI, Request, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, Any, Dict
import pymssql
import json
import base64
import os
import uuid
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# ══════════════════════════════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════════════════════════════

API_KEY     = os.getenv("API_KEY", "change-me")
DB_USER     = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_HOST     = "gb-ads-sql-server.database.windows.net"
DB_NAME     = "userTracker"

# 1x1 transparent GIF pixel
PIXEL_GIF = base64.b64decode(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
)

# ══════════════════════════════════════════════════════════════════════
# APP + CORS
# ══════════════════════════════════════════════════════════════════════

app = FastAPI(title="AppCore Analytics")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # 200+ domenii - allow all
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ══════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════

def get_conn():
    return pymssql.connect(
        server=DB_HOST,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        login_timeout=30,
        as_dict=False,
        autocommit=True
    )


def check_key(request: Request, query_key: Optional[str] = None):
    """Validates API key from X-API-Key header or query string."""
    x_key   = request.headers.get("X-API-Key", "")
    auth    = request.headers.get("Authorization", "")
    bearer  = auth[7:] if auth.startswith("Bearer ") else ""
    provided = x_key or bearer or query_key or ""
    if provided != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


def parse_ts(ts_str: Optional[str]) -> datetime:
    if not ts_str:
        return datetime.utcnow()
    try:
        return datetime.fromisoformat(ts_str.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return datetime.utcnow()


def serialize(val: Any) -> Any:
    if isinstance(val, datetime):
        return val.isoformat()
    return val


def row_to_dict(cursor, row) -> dict:
    return {col[0]: serialize(val) for col, val in zip(cursor.description, row)}


def upsert_profile(
    cursor,
    user_id: str,
    is_pageview: bool = False,
    is_conversion: bool = False,
    slug: Optional[str] = None,
    domain: Optional[str] = None,
    country: Optional[str] = None,
    device_type: Optional[str] = None,
    value: float = 0,
    ts: Optional[datetime] = None,
):
    """Upsert user_profiles - insert on first visit, update on subsequent."""
    now = ts or datetime.utcnow()

    cursor.execute(
        "SELECT domains_visited, first_touch_slug FROM user_profiles WHERE user_id = ?",
        user_id
    )
    row = cursor.fetchone()

    if row is None:
        # First time we see this user → INSERT
        domains = json.dumps([domain] if domain else [])
        cursor.execute(
            """
            INSERT INTO user_profiles
                (user_id, first_seen, last_seen, total_pageviews, total_conversions,
                 total_revenue, domains_visited, first_touch_slug, last_touch_slug,
                 country, device_type, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            user_id, now, now,
            1 if is_pageview else 0,
            1 if is_conversion else 0,
            value if is_conversion else 0,
            domains, slug, slug,
            country, device_type, now, now
        )
    else:
        # Existing user → UPDATE
        try:
            domains_list = json.loads(row[0] or "[]")
        except Exception:
            domains_list = []

        if domain and domain not in domains_list:
            domains_list.append(domain)

        if is_pageview:
            cursor.execute(
                """
                UPDATE user_profiles SET
                    last_seen           = ?,
                    total_pageviews     = total_pageviews + 1,
                    last_touch_slug     = COALESCE(?, last_touch_slug),
                    domains_visited     = ?,
                    updated_at          = ?
                WHERE user_id = ?
                """,
                now, slug, json.dumps(domains_list), now, user_id
            )
        elif is_conversion:
            cursor.execute(
                """
                UPDATE user_profiles SET
                    last_seen           = ?,
                    total_conversions   = total_conversions + 1,
                    total_revenue       = COALESCE(total_revenue, 0) + ?,
                    updated_at          = ?
                WHERE user_id = ?
                """,
                now, value, now, user_id
            )


# ══════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ══════════════════════════════════════════════════════════════════════

class PageviewPayload(BaseModel):
    user_id:          str
    domain:           Optional[str]   = None
    url:              Optional[str]   = None
    slug:             Optional[str]   = None
    referrer:         Optional[str]   = None
    timestamp:        Optional[str]   = None
    utm_source:       Optional[str]   = None
    utm_medium:       Optional[str]   = None
    utm_campaign:     Optional[str]   = None
    utm_content:      Optional[str]   = None
    utm_term:         Optional[str]   = None
    utm_id:           Optional[str]   = None
    fbclid:           Optional[str]   = None
    device_type:      Optional[str]   = None
    browser:          Optional[str]   = None
    os:               Optional[str]   = None
    screen_resolution:Optional[str]   = None
    language:         Optional[str]   = None
    country:          Optional[str]   = None


class ConversionPayload(BaseModel):
    user_id:                    str
    tracking_user_id:           Optional[str]   = None   # Din custom= Digistore URL
    order_id:                   str
    product_name:               Optional[str]   = None
    product_id:                 Optional[str]   = None
    value:                      Optional[float] = 0
    currency:                   Optional[str]   = "EUR"
    domain:                     Optional[str]   = None
    conversion_page:            Optional[str]   = None
    timestamp:                  Optional[str]   = None
    attribution_slug:           Optional[str]   = None
    time_to_conversion_minutes: Optional[int]   = None
    # Digistore24 extra fields (informational)
    net_amount:                 Optional[float] = None
    vat_amount:                 Optional[float] = None
    transaction_id:             Optional[str]   = None
    tags:                       Optional[str]   = None


class ActionPayload(BaseModel):
    user_id:    str
    event_type: Optional[str]              = "custom_event"
    event_name: Optional[str]              = None
    domain:     Optional[str]              = None
    url:        Optional[str]              = None
    timestamp:  Optional[str]              = None
    metadata:   Optional[Dict[str, Any]]   = None


# ══════════════════════════════════════════════════════════════════════
# ENDPOINT 1 — Pageview
# ══════════════════════════════════════════════════════════════════════

@app.post("/api/events", status_code=201)
async def track_pageview(payload: PageviewPayload, request: Request):
    check_key(request)
    ts = parse_ts(payload.timestamp)

    try:
        conn = get_conn()
        c    = conn.cursor()

        c.execute(
            """
            INSERT INTO user_events
                (user_id, event_type, domain, url, slug, referrer,
                 utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, fbclid,
                 device_type, browser, os, screen_resolution, language, country, timestamp)
            VALUES (?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?,?,?,?)
            """,
            payload.user_id, "pageview",
            payload.domain, payload.url, payload.slug, payload.referrer,
            payload.utm_source, payload.utm_medium, payload.utm_campaign,
            payload.utm_content, payload.utm_term, payload.utm_id, payload.fbclid,
            payload.device_type, payload.browser, payload.os,
            payload.screen_resolution, payload.language, payload.country, ts
        )

        upsert_profile(
            c, payload.user_id, is_pageview=True,
            slug=payload.slug, domain=payload.domain,
            country=payload.country, device_type=payload.device_type, ts=ts
        )
        conn.close()

    except Exception as e:
        print(f"[/api/events] ERROR: {e}")

    return {"success": True, "event_id": f"evt_{uuid.uuid4().hex[:12]}"}


# ══════════════════════════════════════════════════════════════════════
# ENDPOINT 2 — Conversion (Purchase)
# ══════════════════════════════════════════════════════════════════════

@app.post("/api/conversions", status_code=201)
async def track_conversion(payload: ConversionPayload, request: Request):
    check_key(request)
    ts = parse_ts(payload.timestamp)

    # tracking_user_id (from Digistore custom param) is more reliable than fingerprint
    uid = payload.tracking_user_id or payload.user_id

    try:
        conn = get_conn()
        c    = conn.cursor()

        # Skip duplicate orders
        c.execute("SELECT id FROM conversions WHERE order_id = ?", payload.order_id)
        if c.fetchone():
            conn.close()
            return {"success": True, "note": "duplicate_skipped"}

        # Calculate time_to_conversion if frontend didn't provide it
        ttc = payload.time_to_conversion_minutes
        if ttc is None:
            c.execute(
                """
                SELECT TOP 1 timestamp FROM user_events
                WHERE user_id = ? AND event_type = 'pageview'
                ORDER BY timestamp ASC
                """,
                uid
            )
            r = c.fetchone()
            if r and r[0]:
                diff = ts - r[0].replace(tzinfo=None)
                ttc  = max(0, int(diff.total_seconds() / 60))

        # Get first-touch slug if frontend didn't provide it
        slug = payload.attribution_slug
        if not slug:
            c.execute(
                """
                SELECT TOP 1 slug FROM user_events
                WHERE user_id = ? AND event_type = 'pageview' AND slug IS NOT NULL
                ORDER BY timestamp ASC
                """,
                uid
            )
            r = c.fetchone()
            if r:
                slug = r[0]

        c.execute(
            """
            INSERT INTO conversions
                (user_id, order_id, product_name, product_id, value, currency,
                 domain, attribution_slug, time_to_conversion_minutes, timestamp)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            """,
            uid, payload.order_id, payload.product_name, payload.product_id,
            payload.value, payload.currency, payload.domain,
            slug, ttc, ts
        )

        upsert_profile(c, uid, is_conversion=True, value=payload.value or 0, ts=ts)
        conn.close()

    except Exception as e:
        print(f"[/api/conversions] ERROR: {e}")

    return {"success": True, "conversion_id": f"conv_{uuid.uuid4().hex[:12]}"}


# ══════════════════════════════════════════════════════════════════════
# ENDPOINT 3 — Custom Events (view_content, checkout_initiated, etc.)
# ══════════════════════════════════════════════════════════════════════

@app.post("/api/actions", status_code=201)
async def track_action(payload: ActionPayload, request: Request):
    check_key(request)
    ts = parse_ts(payload.timestamp)

    # Store event_name inside metadata JSON (user_events table has no event_name column)
    meta = dict(payload.metadata or {})
    if payload.event_name:
        meta["event_name"] = payload.event_name

    try:
        conn = get_conn()
        c    = conn.cursor()

        c.execute(
            """
            INSERT INTO user_events (user_id, event_type, domain, url, timestamp, metadata)
            VALUES (?,?,?,?,?,?)
            """,
            payload.user_id, payload.event_type or "custom_event",
            payload.domain, payload.url, ts,
            json.dumps(meta) if meta else None
        )
        conn.close()

    except Exception as e:
        print(f"[/api/actions] ERROR: {e}")

    return {"success": True, "event_id": f"evt_{uuid.uuid4().hex[:12]}"}


# ══════════════════════════════════════════════════════════════════════
# ENDPOINT 4 — Image Pixel Fallback (ad blocker bypass)
# ══════════════════════════════════════════════════════════════════════

@app.get("/api/p.gif")
async def track_pixel(
    request:      Request,
    user_id:      Optional[str]   = Query(None),
    domain:       Optional[str]   = Query(None),
    url:          Optional[str]   = Query(None),
    slug:         Optional[str]   = Query(None),
    event_type:   Optional[str]   = Query("pageview"),
    event_name:   Optional[str]   = Query(None),
    event_source: Optional[str]   = Query("pixel"),
    product_id:   Optional[str]   = Query(None),
    api_key:      Optional[str]   = Query(None),
):
    no_cache_headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma":  "no-cache",
        "Expires": "0",
    }

    # Always return pixel (even if auth fails - to avoid broken images)
    if api_key != API_KEY or not user_id:
        return Response(content=PIXEL_GIF, media_type="image/gif", headers=no_cache_headers)

    ts   = datetime.utcnow()
    meta = {"event_source": event_source}
    if event_name:
        meta["event_name"] = event_name
    if product_id:
        meta["product_id"] = product_id

    try:
        conn = get_conn()
        c    = conn.cursor()

        c.execute(
            """
            INSERT INTO user_events (user_id, event_type, domain, url, slug, timestamp, metadata)
            VALUES (?,?,?,?,?,?,?)
            """,
            user_id, event_type, domain, url, slug, ts, json.dumps(meta)
        )

        if event_type == "pageview":
            upsert_profile(c, user_id, is_pageview=True, slug=slug, domain=domain, ts=ts)

        conn.close()

    except Exception as e:
        print(f"[/api/p.gif] ERROR: {e}")

    return Response(content=PIXEL_GIF, media_type="image/gif", headers=no_cache_headers)


# ══════════════════════════════════════════════════════════════════════
# ENDPOINT 5 — Beacon API Fallback
# ══════════════════════════════════════════════════════════════════════

@app.post("/api/b")
async def track_beacon(request: Request, api_key: Optional[str] = Query(None)):
    # Always return 200 - Beacon API doesn't retry on failure
    try:
        if api_key != API_KEY:
            return JSONResponse({"success": True})

        body = await request.body()
        data = json.loads(body.decode("utf-8"))

        uid = data.get("user_id")
        if not uid:
            return JSONResponse({"success": True})

        ts         = parse_ts(data.get("timestamp"))
        event_type = data.get("event_type", "pageview")
        meta       = {"event_source": "beacon"}

        if data.get("event_name"):
            meta["event_name"] = data["event_name"]

        conn = get_conn()
        c    = conn.cursor()

        c.execute(
            """
            INSERT INTO user_events (user_id, event_type, domain, url, slug, timestamp, metadata)
            VALUES (?,?,?,?,?,?,?)
            """,
            uid, event_type,
            data.get("domain"), data.get("url"), data.get("slug"),
            ts, json.dumps(meta)
        )

        if event_type == "pageview":
            upsert_profile(
                c, uid, is_pageview=True,
                slug=data.get("slug"), domain=data.get("domain"), ts=ts
            )

        conn.close()

    except Exception as e:
        print(f"[/api/b] ERROR: {e}")

    return JSONResponse({"success": True, "event_id": f"evt_{uuid.uuid4().hex[:12]}"})


# ══════════════════════════════════════════════════════════════════════
# ENDPOINT 6 — User Journey (for dashboard)
# ══════════════════════════════════════════════════════════════════════

@app.get("/api/journey/{user_id}")
async def get_user_journey(
    user_id: str,
    request: Request,
    limit:   int = Query(100, le=500)
):
    check_key(request)

    try:
        conn = get_conn()
        c    = conn.cursor()

        c.execute("SELECT * FROM user_profiles WHERE user_id = ?", user_id)
        profile_row = c.fetchone()
        profile     = row_to_dict(c, profile_row) if profile_row else {}

        c.execute(
            """
            SELECT TOP (?) event_type, domain, url, slug, utm_content, timestamp, metadata
            FROM user_events
            WHERE user_id = ?
            ORDER BY timestamp ASC
            """,
            limit, user_id
        )
        events = [row_to_dict(c, r) for r in c.fetchall()]

        c.execute(
            "SELECT * FROM conversions WHERE user_id = ? ORDER BY timestamp ASC",
            user_id
        )
        conversions = [row_to_dict(c, r) for r in c.fetchall()]

        conn.close()

        return {
            "user_id":     user_id,
            "profile":     profile,
            "events":      events,
            "conversions": conversions,
        }

    except Exception as e:
        print(f"[/api/journey] ERROR: {e}")
        raise HTTPException(status_code=500, detail="Internal error")


# ══════════════════════════════════════════════════════════════════════
# HEALTH CHECK
# ══════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    try:
        conn = get_conn()
        conn.cursor().execute("SELECT 1")
        conn.close()
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {e}"

    return {
        "status":    "ok",
        "db":        db_status,
        "timestamp": datetime.utcnow().isoformat()
    }

# ══════════════════════════════════════════════════════════════════════
# META CONVERSION API PROXY
# ══════════════════════════════════════════════════════════════════════

class MetaConversionPayload(BaseModel):
    event_name: str
    event_id: Optional[str] = None
    value: Optional[float] = None
    currency: Optional[str] = None
    extra: Optional[Dict[str, Any]] = None

@app.post("/api/meta-conversion", status_code=200)
async def meta_conversion(payload: MetaConversionPayload, request: Request):
    """
    Stub for Meta Conversion API proxy.
    Wire up real Meta CAPI call here when Pixel ID + access token are available.
    """
    print(f"[meta-conversion] {payload.event_name} | id={payload.event_id} | value={payload.value} {payload.currency}")
    return {"status": "received", "event_name": payload.event_name}

# ══════════════════════════════════════════════════════════════════════
# STATIC FILES — serve HTML test pages (must be last, after all routes)
# ══════════════════════════════════════════════════════════════════════
_STATIC_DIR = os.path.join(os.path.dirname(__file__), "..")
app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="static")
