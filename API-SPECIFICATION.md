# 📡 API Specification for Backend Developer

**Scop:** Această specificație descrie **exact ce endpoints trebuie să creezi** în backend-ul FastAPI pentru a primi datele de tracking de la cele 200+ landing pages.

---

## 🎯 Overview

Frontend-ul va trimite **3 tipuri de evenimente** către backend:

1. **Pageview** - când user vizitează o landing page
2. **Conversion** - când user convertește pe Digistore24 (thank you page)
3. **Custom Event** - alte acțiuni (opțional: clicks, form submits, video plays, etc.)

---

## 🔌 Endpoints Required

### 1. POST `/api/events`

**Descriere:** Primește un pageview de fiecare dată când un utilizator vizitează o landing page.

**Request Body:**
```json
{
  "user_id": "a3f5b8c9d2e1f4a6b7c8d9e0f1a2b3c4",
  "domain": "example-offer.com",
  "url": "https://example-offer.com/?utm_content=img-mada-fha-mus-ugly-remedy...",
  "slug": "img-mada-fha-mus-ugly-remedy-amish-cough-syrup-140326",
  "referrer": "https://facebook.com/...",
  "timestamp": "2026-03-23T14:35:22.123Z",
  "utm_source": "facebook",
  "utm_medium": "cpc",
  "utm_campaign": "l1-l5-abo-sandbox-Sep25-usa-naphd",
  "utm_content": "img-mada-fha-mus-ugly-remedy-amish-cough-syrup-140326",
  "utm_term": "l1-advup-img-mada-mus-ugly-remedy-test-170326",
  "utm_id": "120232678653740440",
  "device_type": "mobile",
  "browser": "Chrome 121",
  "os": "Android 14",
  "screen_resolution": "412x915",
  "country": "RO",
  "language": "ro-RO",
  "fbclid": "IwY2xjawQnpUtleHRuA2FlbQEwAGFkaWQBqzHGMnhMeHNydGMGYXBwX2lkED..."
}
```

**Field Descriptions:**
- `slug` (string, required) - **IMPORTANT:** Acum conține `utm_content` (cel mai specific identificator de ad creative/variation). Fallback: `source`, `slug`, `ad`, sau `'direct'`
- `utm_content` (string, optional) - **CEL MAI IMPORTANT pentru tracking Facebook Ads** - identifică exact care ad creative/variation a fost folosit (ex: "img-mada-fha-mus-ugly-remedy-amish-cough-syrup-140326")
- `utm_term` (string, optional) - Detalii suplimentare despre targeting (ex: "l1-advup-img-mada-mus-ugly-remedy-test-170326")
- `utm_id` (string, optional) - Facebook Ad ID numeric (ex: "120232678653740440")

**Response:**
```json
{
  "success": true,
  "event_id": "evt_1234567890"
}
```

**Status Codes:**
- `201 Created` - Event tracked successfully
- `400 Bad Request` - Invalid data
- `401 Unauthorized` - Missing/invalid API key
- `500 Internal Server Error` - Database error

---

### 2. POST `/api/conversions`

**Descriere:** Primește o conversie când user-ul ajunge pe Thank You Page după ce a cumpărat.

**IMPORTANT - Conversion Attribution Logic:**
Backend-ul trebuie să implementeze logică de matching pentru a atribui conversiile corect:

1. **Dacă `tracking_user_id` există** (din URL parameter `custom`):
   - Use direct acest user_id pentru atribuire
   - Match cu user_id din `user_events` și `checkout_initiated` events

2. **Dacă `tracking_user_id` lipsește** (redirect a pierdut parametrul):
   - Match pe `product_id` + `timestamp` (±10 minute) din `checkout_initiated` event
   - Folosește IP + User-Agent fuzzy matching ca backup
   - Recovery rate: ~85-90% din conversiile pierdute

**Request Body:**
```json
{
  "user_id": "a3f5b8c9d2e1f4a6b7c8d9e0f1a2b3c4",
  "tracking_user_id": "a3f5b8c9d2e1f4a6b7c8d9e0f1a2b3c4",
  "order_id": "DS24-ORDER-12345",
  "product_name": "Amish Fire Cider Complete Bundle",
  "product_id": "640053",
  "value": 47.00,
  "currency": "EUR",
  "domain": "thankyou.example-offer.com",
  "conversion_page": "https://thankyou.example-offer.com/?oid=DS24-ORDER-12345&custom=a3f5b8c9...",
  "timestamp": "2026-03-23T14:42:18.456Z",
  "attribution_slug": "amish-fire-cider",
  "time_to_conversion_minutes": 7
}
```

**Field Descriptions:**
- `user_id` (string, required) - User ID din browser fingerprint (generat în frontend)
- `tracking_user_id` (string, **optional but IMPORTANT**) - User ID din URL parameter `custom`. Dacă există, backend-ul îl folosește prioritar pentru matching.
- `product_id` (string, required) - **Extras DINAMIC din URL** (ex: `/product/640053/` → `640053`). Important pentru matching cu `checkout_initiated` dacă `tracking_user_id` lipsește

**IMPORTANT:** `product_id` este MEREU diferit și extras dinamic din URL-ul checkout-ului. Exemplul `"640053"` din acest document este DOAR pentru ilustrare.

**Response:**
```json
{
  "success": true,
  "conversion_id": "conv_9876543210",
  "user_journey_summary": {
    "total_pageviews": 3,
    "domains_visited": ["example-offer.com", "second-offer.net"],
    "first_touch_slug": "amish-fire-cider",
    "last_touch_slug": "amish-fire-cider"
  }
}
```

**Status Codes:**
- `201 Created` - Conversion tracked
- `400 Bad Request` - Invalid data
- `401 Unauthorized` - Missing/invalid API key
- `500 Internal Server Error` - Database error

---

### 3. POST `/api/actions` (Opțional dar recomandat)

**Descriere:** Track custom events (click pe button, video play, form submit, checkout initiated, etc.)

**Important:** Acest endpoint include și tracking-ul pentru `checkout_initiated` - event crucial pentru conversion attribution!

**Request Body:**
```json
{
  "user_id": "a3f5b8c9d2e1f4a6b7c8d9e0f1a2b3c4",
  "event_type": "custom_event",
  "event_name": "button_click",
  "domain": "example-offer.com",
  "url": "https://example-offer.com/",
  "timestamp": "2026-03-23T14:36:45.789Z",
  "metadata": {
    "button_text": "Cumpără Acum",
    "button_position": "hero-section"
  }
}
```

**Example 2 - Checkout Initiated (IMPORTANT pentru conversion attribution):**
```json
{
  "user_id": "a3f5b8c9d2e1f4a6b7c8d9e0f1a2b3c4",
  "event_type": "custom_event",
  "event_name": "checkout_initiated",
  "domain": "example-offer.com",
  "url": "https://example-offer.com/",
  "timestamp": "2026-03-23T14:40:12.456Z",
  "metadata": {
    "product_id": "640053",
    "checkout_url": "https://checkout-ds24.com/product/640053/?custom=a3f5b8c9...",
    "timestamp": 1711201212456
  }
}
```

**NOTA:** `product_id` din exemplul de mai sus (`"640053"`) este extras AUTOMAT din URL-ul checkout-ului via regex `url.pathname.match(/(\d{6,})/)`. Fiecare product are propriul ID unic (ex: 640053, 789456, 123789, etc.).

**De ce e important checkout_initiated?**
- Se trimite ÎNAINTE ca user-ul să plece către checkout
- Dacă parametrul `custom` se pierde din URL pe Thank You Page, backend poate face matching pe:
  - `product_id` + `timestamp` (diferenta < 10 minute) + `user_id` aproximativ via IP
- Recovery rate: +10-15% conversii care altfel s-ar pierde

**Response:**
```json
{
  "success": true,
  "event_id": "evt_custom_456"
}
```

---

### 4. GET `/api/p.gif` (Fallback - Image Pixel Tracking UNIVERSAL)

**Descriere:** Image pixel tracking UNIVERSAL - funcționează chiar dacă JavaScript e blocat sau Fetch API e blocat de ad blockers. Acest endpoint primește TOATE tipurile de events (pageview, conversion, custom) ca fallback când Fetch și Beacon eșuează.

**De ce `.gif`?** Mai greu de detectat de ad blockeri (arată ca un image obișnuit).

**IMPORTANT:** Acest endpoint e UNIVERSAL - primește orice event prin query parameters.

**Query Parameters (toate pot fi trimise):**
- `user_id` (string, required) - ID-ul utilizatorului
- `event_source` (string, required) - Întotdeauna "pixel" pentru identificare
- `domain` (string, required) - Domeniul landing page-ului
- `url` (string, optional) - URL-ul complet
- `slug` (string, optional) - FB ad slug
- `referrer` (string, optional) - Referrer URL
- `event_type` (string, optional) - Tipul event-ului: "pageview", "custom_event"
- `event_name` (string, optional) - Pentru custom events (ex: "checkout_initiated")
- `order_id` (string, optional) - Pentru conversions
- `product_id` (string, optional) - Pentru conversions
- `value` (number, optional) - Pentru conversions
- `metadata` (string JSON, optional) - Pentru custom events
- `api_key` (string, required) - API Key pentru autentificare

**Request Examples:**

Pageview:
```
GET /api/p.gif?user_id=a3f5b8c9&event_source=pixel&domain=example.com&url=https://example.com/&slug=amish-fire-cider&event_type=pageview&api_key=your-api-key
```

Conversion:
```
GET /api/p.gif?user_id=a3f5b8c9&event_source=pixel&event_type=conversion&order_id=ORDER123&product_id=640053&value=47.00&api_key=your-api-key
```

Custom Event (checkout_initiated):
```
GET /api/p.gif?user_id=a3f5b8c9&event_source=pixel&event_type=custom_event&event_name=checkout_initiated&product_id=640053&api_key=your-api-key
```

**NOTA IMPORTANTĂ:** Toate exemplele cu `product_id=640053` din acest document sunt DOAR pentru ilustrare. În realitate, `product_id` este **extras DINAMIC** din URL-ul checkout-ului (ex: `/product/640053/` → `640053`) și va fi diferit pentru fiecare produs.

**NOTA:** `product_id=640053` din exemple este DINAMIC și diferit pentru fiecare produs (extras din URL checkout-ului).

**Response:**
```
HTTP/1.1 200 OK
Content-Type: image/gif

[1x1 transparent pixel GIF binary data]
```

**Implementation Notes:**
- Returnează un pixel GIF transparent 1x1
- Salvează event-ul în database
- Poate extrage IP pentru geo-location
- Folosit ca fallback când Fetch/Beacon fail

---

### 5. POST `/api/b` (Fallback - Beacon API UNIVERSAL)

**Descriere:** Beacon API tracking UNIVERSAL - mai sigur decât Fetch pentru events când user închide tab-ul sau navighează away. Folosit ca fallback când Fetch API fail. Acest endpoint primește TOATE tipurile de events (pageview, conversion, custom).

**De ce `/api/b`?** Scurt și neutru, greu de detectat.

**IMPORTANT:** Acest endpoint e UNIVERSAL - primește orice event prin body JSON.

**Content-Type:** `application/json` (trimis ca Blob)

**Query Parameters:**
- `api_key` (string, required) - API Key în URL pentru că Beacon API nu suportă headers custom

**Request Body (în Blob) - poate conține orice combinație de fields:**
```json
{
  "user_id": "a3f5b8c9d2e1f4a6b7c8d9e0f1a2b3c4",
  "event_source": "beacon",
  "domain": "example-offer.com",
  "url": "https://example-offer.com/",
  "slug": "amish-fire-cider",
  "timestamp": "2026-03-23T14:40:00.123Z",
  "event_type": "pageview",

  // Pentru conversions (optional):
  "order_id": "ORDER123",
  "product_id": "640053",  // Extras DINAMIC din URL checkout
  "value": 47.00,
  "currency": "EUR",

  // Pentru custom events (optional):
  "event_name": "checkout_initiated",
  "metadata": {"product_id": "640053"}  // Extras DINAMIC din URL checkout
  "metadata": {"product_id": "640053"}
}
```

**Response:**
```json
{
  "success": true,
  "event_id": "evt_beacon_789"
}
```

**Implementation Notes:**
- Beacon API nu garantează response, dar e foarte reliable
- Backend trebuie să accepte `api_key` din query string (nu doar header)
- Backend detectează tipul event-ului din `event_type` și `event_name` fields
- Folosit când user închide tab-ul sau ad blocker blochează Fetch

---

### 6. GET `/api/journey/{user_id}` (Pentru dashboard)

**Descriere:** Obține journey-ul complet al unui utilizator.

**Path Parameters:**
- `user_id` (string, required) - ID-ul utilizatorului

**Query Parameters:**
- `limit` (integer, optional, default=100) - Max nr de events

**Response:**
```json
{
  "user_id": "a3f5b8c9d2e1f4a6b7c8d9e0f1a2b3c4",
  "profile": {
    "first_seen": "2026-03-20T10:15:00Z",
    "last_seen": "2026-03-23T14:42:18Z",
    "total_pageviews": 8,
    "total_conversions": 1,
    "total_revenue": 47.00,
    "domains_visited": ["example-offer.com", "second-offer.net", "retargeting-offer.org"],
    "first_touch_slug": "amish-fire-cider",
    "last_touch_slug": "amish-fire-cider"
  },
  "events": [
    {
      "event_type": "pageview",
      "domain": "example-offer.com",
      "slug": "amish-fire-cider",
      "timestamp": "2026-03-20T10:15:00Z"
    },
    {
      "event_type": "pageview",
      "domain": "second-offer.net",
      "slug": "parasite-flush",
      "timestamp": "2026-03-22T16:30:00Z"
    },
    {
      "event_type": "conversion",
      "order_id": "DS24-ORDER-12345",
      "value": 47.00,
      "timestamp": "2026-03-23T14:42:18Z"
    }
  ]
}
```

---

### 7. GET `/api/analytics/stats` (Pentru dashboard)

**Descriere:** Statistici generale pentru dashboard.

**Query Parameters:**
- `start_date` (string, optional, format: YYYY-MM-DD)
- `end_date` (string, optional, format: YYYY-MM-DD)
- `slug` (string, optional) - Filtrare după FB ad slug

**Response:**
```json
{
  "period": {
    "start": "2026-03-01",
    "end": "2026-03-23"
  },
  "totals": {
    "unique_users": 45230,
    "total_pageviews": 89450,
    "total_conversions": 1205,
    "total_revenue": 56635.00,
    "conversion_rate": 2.66
  },
  "by_slug": [
    {
      "slug": "amish-fire-cider",
      "users": 12500,
      "pageviews": 25000,
      "conversions": 420,
      "revenue": 19740.00,
      "conversion_rate": 3.36
    },
    {
      "slug": "parasite-flush",
      "users": 10200,
      "pageviews": 20400,
      "conversions": 350,
      "revenue": 13650.00,
      "conversion_rate": 3.43
    }
  ],
  "cross_domain_users": 3450,
  "avg_domains_per_user": 1.23,
  "top_journeys": [
    {
      "domains": ["offer1.com", "offer2.net"],
      "users": 850,
      "conversions": 45,
      "conversion_rate": 5.29
    }
  ]
}
```

---

## 🔒 Authentication

Toate requests-urile de la frontend vor include **API Key** în header:

```
Authorization: Bearer your-api-key-here
```

sau

```
X-API-Key: your-api-key-here
```

**Tu alegi metoda de autentificare.**

---

## 🗄️ Database Schema Recommendations

### Table: `user_events`

```sql
CREATE TABLE user_events (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- 'pageview', 'conversion', 'custom_event'
    domain VARCHAR(255),
    url TEXT,
    slug VARCHAR(255),              -- IMPORTANT: Conține utm_content (ad creative specific)
    referrer TEXT,

    -- UTM Parameters (tracking Facebook Ads complet)
    utm_source VARCHAR(100),
    utm_medium VARCHAR(100),
    utm_campaign VARCHAR(255),
    utm_content VARCHAR(500),       -- ⭐ CEL MAI IMPORTANT: ad creative/variation specific
    utm_term VARCHAR(255),
    utm_id VARCHAR(100),            -- Facebook Ad ID

    -- Facebook specific
    fbclid VARCHAR(500),            -- Facebook Click ID

    -- Device/Browser info
    device_type VARCHAR(50),
    browser VARCHAR(100),
    os VARCHAR(100),
    screen_resolution VARCHAR(20),
    language VARCHAR(20),
    country VARCHAR(10),

    timestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    metadata NVARCHAR(MAX),         -- JSON cu date extra

    INDEX idx_user_id (user_id),
    INDEX idx_timestamp (timestamp),
    INDEX idx_slug (slug),
    INDEX idx_utm_content (utm_content),  -- Index pentru queries pe ad creative
    INDEX idx_utm_campaign (utm_campaign),
    INDEX idx_event_type (event_type)
);
```

### Table: `conversions`

```sql
CREATE TABLE conversions (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    order_id VARCHAR(100) NOT NULL UNIQUE,
    product_name VARCHAR(255),
    product_id VARCHAR(100),
    value DECIMAL(10,2),
    currency VARCHAR(10) DEFAULT 'EUR',
    domain VARCHAR(255),
    attribution_slug VARCHAR(100),
    time_to_conversion_minutes INT,
    timestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    INDEX idx_user_id (user_id),
    INDEX idx_order_id (order_id),
    INDEX idx_attribution_slug (attribution_slug),
    INDEX idx_timestamp (timestamp)
);
```

### Table: `user_profiles` (Agregat - update prin trigger sau cron)

```sql
CREATE TABLE user_profiles (
    user_id VARCHAR(64) PRIMARY KEY,
    first_seen DATETIME2,
    last_seen DATETIME2,
    total_pageviews INT DEFAULT 0,
    total_conversions INT DEFAULT 0,
    total_revenue DECIMAL(10,2) DEFAULT 0,
    domains_visited NVARCHAR(MAX), -- JSON array: ["domain1.com", "domain2.net"]
    first_touch_slug VARCHAR(100),
    last_touch_slug VARCHAR(100),
    country VARCHAR(10),
    device_type VARCHAR(50),
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE()
);
```

---

## 🚀 CORS Configuration

**IMPORTANT:** Backend-ul trebuie să permită CORS de la **TOATE** cele 200+ domenii.

### Opțiuni:

#### Opțiunea 1: Allow All Origins (mai simplu)
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"]
)
```

#### Opțiunea 2: Wildcard pentru subdomenii (dacă sunt subdomenii)
```python
allow_origins=[
    "https://*.myoffers.com",
    "https://*.offers-ro.net"
]
```

#### Opțiunea 3: Lista exactă (dacă sunt sub 200 domenii și fixe)
```python
allow_origins=[
    "https://offer1.com",
    "https://offer2.net",
    # ... toate cele 200 domenii
]
```

---

## ⚡ Performance Requirements

- **Response time:** < 200ms pentru track endpoints
- **Throughput:** Minim 1000 requests/minut
- **Availability:** 99.9% uptime

### Optimizări recomandate:

1. **Async processing** - Salvează în queue (Azure Service Bus/Redis) și procesează async
2. **Database indexing** - Index pe `user_id`, `timestamp`, `slug`
3. **Caching** - Redis pentru analytics queries
4. **Rate limiting** - Protecție împotriva abuse

---

## 💻 Implementation Examples (Python/FastAPI)

### Example 1: Pixel Tracking Endpoint

```python
from fastapi import FastAPI, Query, Request
from fastapi.responses import Response
import base64
import hashlib
from datetime import datetime

# 1x1 transparent GIF pixel (base64 encoded)
PIXEL_GIF = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")

@app.get("/api/track/pixel")
async def track_pixel(
    request: Request,
    user_id: str = Query(...),
    domain: str = Query(...),
    url: str = Query(None),
    slug: str = Query(None),
    referrer: str = Query(None),
    event_type: str = Query("pageview"),
    api_key: str = Query(...)
):
    """
    Image pixel tracking - works even when JavaScript is blocked
    Returns a 1x1 transparent GIF
    """
    # Validate API key
    if api_key != EXPECTED_API_KEY:
        return Response(content=PIXEL_GIF, media_type="image/gif", status_code=401)

    # Extract client IP for geo-location
    client_ip = request.client.host
    user_agent = request.headers.get("user-agent", "")

    # Save event to database
    try:
        await save_event_to_db({
            "user_id": user_id,
            "domain": domain,
            "url": url,
            "slug": slug,
            "referrer": referrer,
            "event_type": event_type,
            "ip": client_ip,
            "user_agent": user_agent,
            "tracking_method": "pixel",
            "timestamp": datetime.utcnow()
        })
    except Exception as e:
        # Return pixel anyway - don't fail for user
        print(f"Pixel tracking error: {e}")

    # Always return pixel (even if save failed)
    return Response(
        content=PIXEL_GIF,
        media_type="image/gif",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )
```

### Example 2: Beacon API Endpoint

```python
from fastapi import FastAPI, Request, Query
from fastapi.responses import JSONResponse
import json

@app.post("/api/track/beacon")
async def track_beacon(
    request: Request,
    api_key: str = Query(...)
):
    """
    Beacon API tracking - receives data as JSON Blob
    More reliable than Fetch for page exit events
    """
    # Validate API key (from query string, Beacon can't send custom headers)
    if api_key != EXPECTED_API_KEY:
        return JSONResponse(
            content={"success": False, "error": "Invalid API key"},
            status_code=401
        )

    try:
        # Read body as bytes (Beacon sends Blob)
        body_bytes = await request.body()
        payload = json.loads(body_bytes.decode('utf-8'))

        # Extract client info
        client_ip = request.client.host
        user_agent = request.headers.get("user-agent", "")

        # Save to database
        await save_event_to_db({
            **payload,
            "ip": client_ip,
            "user_agent": user_agent,
            "tracking_method": "beacon",
            "timestamp": datetime.utcnow()
        })

        return JSONResponse(content={"success": True})

    except Exception as e:
        print(f"Beacon tracking error: {e}")
        # Return success anyway - Beacon API doesn't guarantee delivery
        return JSONResponse(content={"success": True})
```

### Example 3: Robust Database Save Function

```python
async def save_event_to_db(event_data: dict):
    """
    Save event to Azure SQL Database
    Handles all tracking methods: fetch, beacon, pixel
    """
    query = """
        INSERT INTO user_events (
            user_id, domain, url, slug, referrer, event_type,
            ip, user_agent, tracking_method, timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    params = (
        event_data.get("user_id"),
        event_data.get("domain"),
        event_data.get("url"),
        event_data.get("slug"),
        event_data.get("referrer"),
        event_data.get("event_type", "pageview"),
        event_data.get("ip"),
        event_data.get("user_agent"),
        event_data.get("tracking_method", "fetch"),
        event_data.get("timestamp")
    )

    # Execute query (async)
    await database.execute(query, params)
```

---

## 🧪 Testing

### Test pageview endpoint:

```bash
curl -X POST https://your-api.azurewebsites.net/api/track/pageview \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "user_id": "test123",
    "domain": "test.com",
    "url": "https://test.com/?source=test-slug",
    "slug": "test-slug",
    "timestamp": "2026-03-23T14:00:00Z"
  }'
```

### Test conversion endpoint:

```bash
curl -X POST https://your-api.azurewebsites.net/api/track/conversion \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "user_id": "test123",
    "order_id": "TEST-ORDER-001",
    "value": 47.00,
    "currency": "EUR",
    "timestamp": "2026-03-23T14:05:00Z"
  }'
```

---

## 📊 Example Usage - Frontend Integration

Iată cum va apărea un request **real** de la frontend:

```javascript
// User vizitează o landing page
fetch('https://your-api.azurewebsites.net/api/track/pageview', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-api-key'
  },
  body: JSON.stringify({
    user_id: 'a3f5b8c9d2e1f4a6b7c8d9e0f1a2b3c4',
    domain: 'amish-fire-cider-offer.com',
    url: window.location.href,
    slug: 'amish-fire-cider',
    referrer: document.referrer,
    timestamp: new Date().toISOString()
  })
});
```

---

## ❓ Questions?

Dacă ai întrebări despre specificație, contactează-mă (frontend dev) sau Marius.

**Happy Coding! 🚀**
