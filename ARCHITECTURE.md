# User Journey Tracker - Architecture Overview

## 📐 System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  FRONTEND (200+ Landing Pages pe domenii diferite)                     │
│  ─────────────────────────────────────────────────────────────────     │
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ domain1.com │  │ domain2.net │  │ domain3.org │  │ domain200...│  │
│  │             │  │             │  │             │  │             │  │
│  │  Landing    │  │  Landing    │  │  Landing    │  │  Landing    │  │
│  │  Page       │  │  Page       │  │  Page       │  │  Page       │  │
│  │             │  │             │  │             │  │             │  │
│  │ [Tracker.js]│  │ [Tracker.js]│  │ [Tracker.js]│  │ [Tracker.js]│  │
│  └─────┬───────┘  └─────┬───────┘  └─────┬───────┘  └─────┬───────┘  │
│        │                │                │                │            │
│        └────────────────┴────────────────┴────────────────┘            │
│                             │                                          │
│                             │ HTTPS POST                               │
│                             │ /track/pageview                          │
│                             │ /track/conversion                        │
│                             │                                          │
└─────────────────────────────┼──────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  BACKEND (Azure Web App / Container)                                   │
│  ────────────────────────────────────────────────────────────          │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────┐    │
│  │  FastAPI Backend (Python)                                     │    │
│  │  ────────────────────────────────────────                     │    │
│  │                                                                │    │
│  │  Endpoints:                                                    │    │
│  │  • POST /track/pageview      - Track pageview events          │    │
│  │  • POST /track/conversion    - Track conversions              │    │
│  │  • POST /track/custom        - Track custom events            │    │
│  │  • GET  /analytics/*         - Query user journeys            │    │
│  │  • GET  /health              - Health check                   │    │
│  │                                                                │    │
│  │  Authentication: API Key in X-API-Key header                  │    │
│  │  CORS: Permite toate domeniile landing pages                  │    │
│  │                                                                │    │
│  └───────────────────────┬───────────────────────────────────────┘    │
│                          │                                             │
└──────────────────────────┼─────────────────────────────────────────────┘
                           │
                           │ SQL Queries
                           │ (pyodbc / ODBC Driver 18)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  DATABASE (Azure SQL Database)                                         │
│  ───────────────────────────────────────────────────────────           │
│                                                                         │
│  Tables:                                                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐       │
│  │  user_events    │  │  conversions    │  │  user_profiles  │       │
│  │  ─────────────  │  │  ─────────────  │  │  ────────────── │       │
│  │  • user_id      │  │  • user_id      │  │  • user_id      │       │
│  │  • timestamp    │  │  • order_id     │  │  • first_seen   │       │
│  │  • domain       │  │  • order_value  │  │  • last_seen    │       │
│  │  • page_url     │  │  • product_name │  │  • conversions  │       │
│  │  • slug (FB ad) │  │  • timestamp    │  │  • revenue      │       │
│  │  • utm_*        │  │  • slug         │  │  • first_slug   │       │
│  │  • fingerprint  │  │  • fingerprint  │  │  • domains[]    │       │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘       │
│                                                                         │
│  Views & Stored Procedures:                                            │
│  • v_cross_domain_users      - Users pe multiple domenii              │
│  • v_conversion_by_slug       - Conversion rate per FB ad             │
│  • v_daily_stats             - Daily statistics                       │
│  • sp_get_user_journey       - Complete user journey                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Data Flow

### 1. Pageview Event Flow

```
User visits landing page (domain1.com?slug=amish-fire-cider)
    │
    ├─► app-core.js loaded
    │
    ├─► Generate browser fingerprint (SHA-256 hash)
    │       • Canvas fingerprint
    │       • WebGL fingerprint
    │       • Screen resolution, timezone, fonts, etc.
    │
    ├─► Check localStorage for cached user_id
    │       • If exists & fingerprint matches → use cached
    │       • If not → user_id = fingerprint hash
    │
    ├─► Extract URL parameters
    │       • slug (FB ad identifier)
    │       • utm_source, utm_medium, utm_campaign, etc.
    │       • fbclid (Facebook click ID)
    │
    ├─► Send POST request to backend
    │       POST /track/pageview
    │       {
    │         "user_id": "abc123...",
    │         "fingerprint": "abc123...",
    │         "domain": "domain1.com",
    │         "page_url": "https://domain1.com/?slug=...",
    │         "slug": "amish-fire-cider",
    │         "utm_source": "facebook",
    │         ...
    │       }
    │
    └─► Backend saves to Azure SQL
            INSERT INTO user_events (...)

            Trigger: sp_update_user_profile
                • Update user_profiles table
                • Set first_seen, last_seen
                • Increment total_pageviews
```

### 2. Conversion Event Flow

```
User completes purchase on Digistore24
    │
    ├─► Redirected to Thank You Page
    │       URL: thankyou.com?order_id=123&order_value=47&uid=abc123...
    │
    ├─► app-core.js loaded
    │
    ├─► Extract conversion parameters from URL
    │       • order_id, product_name, order_value
    │       • digistore_order_id (from Digistore24)
    │
    ├─► Call: AppCore.trackConversion({...})
    │
    ├─► Send POST request to backend
    │       POST /track/conversion
    │       {
    │         "user_id": "abc123...",
    │         "order_id": "ORDER-123",
    │         "order_value": 47.00,
    │         "product_name": "Fire Cider",
    │         ...
    │       }
    │
    └─► Backend saves to Azure SQL
            INSERT INTO conversions (...)

            Trigger: sp_update_user_profile_conversion
                • Update user_profiles table
                • Increment total_conversions
                • Add to total_revenue
```

### 3. Cross-Domain Tracking Flow

```
User Journey Example:

Day 1, 10:00 AM
┌──────────────────────────────────────────────┐
│ User clicks FB ad (slug=amish-fire-cider)   │
│ → Lands on domain1.com                       │
│ → Fingerprint: abc123...                     │
│ → Saved in user_events:                      │
│   - user_id: abc123                          │
│   - domain: domain1.com                      │
│   - slug: amish-fire-cider                   │
│   - timestamp: 2026-03-23 10:00:00          │
└──────────────────────────────────────────────┘
        │
        ▼
Day 1, 10:15 AM
┌──────────────────────────────────────────────┐
│ User clicks on another ad (slug=parasite)   │
│ → Lands on domain2.net                       │
│ → Fingerprint: abc123... (SAME!)             │
│ → Saved in user_events:                      │
│   - user_id: abc123                          │
│   - domain: domain2.net                      │
│   - slug: parasite-flush                     │
│   - timestamp: 2026-03-23 10:15:00          │
└──────────────────────────────────────────────┘
        │
        ▼
Day 2, 09:00 AM
┌──────────────────────────────────────────────┐
│ User returns directly to domain1.com         │
│ → Fingerprint: abc123... (SAME!)             │
│ → Clicks checkout → Digistore24              │
│ → uid=abc123 added to URL automatically      │
└──────────────────────────────────────────────┘
        │
        ▼
Day 2, 09:05 AM
┌──────────────────────────────────────────────┐
│ Purchase completed                           │
│ → Thank You Page with uid=abc123             │
│ → Conversion tracked                         │
│ → Saved in conversions:                      │
│   - user_id: abc123                          │
│   - order_value: 47.00                       │
│   - timestamp: 2026-03-23 09:05:00          │
└──────────────────────────────────────────────┘

Analytics Result:
─────────────────────────────────────────────────
User abc123 journey:
• First touch: amish-fire-cider (domain1.com)
• Visited 2 domains
• 3 total pageviews
• Converted after 23 hours
• Revenue: 47.00 EUR
```

---

## 🧩 Key Components Explained

### 1. Browser Fingerprinting

**Why?** Pentru identificare consistentă cross-domain (cookies nu funcționează între domenii diferite)

**How it works:**
```javascript
Fingerprint = SHA256(
    screen resolution +
    canvas fingerprint +
    WebGL vendor/renderer +
    installed fonts +
    timezone +
    language +
    platform +
    hardware specs
)

Result: Consistent hash pe toate domeniile (95%+ accuracy)
```

**Fallback:** localStorage per-domain pentru caching

### 2. URL Parameter Enhancement

**Problem:** Când user merge de pe landing page la checkout (Digistore24), pierdem tracking-ul

**Solution:** Tracker-ul automat adaugă `uid` în toate link-urile către checkout

```javascript
// Link original
<a href="https://digistore24.com/product/123">Buy Now</a>

// Link enhanced automat de tracker
<a href="https://digistore24.com/product/123?uid=abc123...">Buy Now</a>

// În Digistore24 Custom Fields, configurezi să primești uid
// Apoi pe Thank You Page, folosești acest parameter pentru tracking
```

### 3. API Authentication

**Security:** Fiecare request către backend necesită API Key în header

```javascript
fetch('https://api.example.com/track/pageview', {
    method: 'POST',
    headers: {
        'X-API-Key': 'your-secure-api-key',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({...})
})
```

În Azure Web App settings, păstrezi API_KEY în environment variables (nu în cod!)

---

## 📊 Analytics Use Cases

### 1. Attribution Analysis
**Question:** Care FB ad (slug) convertește cel mai bine?

```sql
SELECT first_slug,
       SUM(total_conversions) as conversions,
       SUM(total_revenue) as revenue
FROM user_profiles
GROUP BY first_slug
ORDER BY revenue DESC;
```

### 2. Multi-Touch Journey
**Question:** Câți users vizitează 2+ landing pages înainte de conversie?

```sql
SELECT * FROM v_cross_domain_users
WHERE domains_visited >= 2;
```

### 3. Time to Conversion
**Question:** Cât durează până convertesc users în medie?

```sql
SELECT AVG(DATEDIFF(hour, first_seen, last_seen)) as avg_hours
FROM user_profiles
WHERE total_conversions > 0;
```

### 4. Retargeting Audiences
**Question:** Users care au vizitat 2+ pagini dar nu au convertit?

```sql
SELECT user_id, first_slug, domains_visited
FROM user_profiles
WHERE total_conversions = 0 AND total_pageviews >= 2;
```

---

## 🔐 Security & Privacy

### GDPR Compliance
- ✅ Fingerprinting-ul este anonymized (SHA-256 hash, nu PII)
- ✅ Nu stochezi email, nume, sau alte date personale
- ✅ Users pot șterge localStorage pentru opt-out
- ✅ Transparență: Informează users că folosești tracking analytics

### Data Retention
```sql
-- Auto-delete events mai vechi de 1 an (cu SQL Agent Job)
DELETE FROM user_events WHERE timestamp < DATEADD(year, -1, GETDATE());
DELETE FROM conversions WHERE timestamp < DATEADD(year, -1, GETDATE());
```

### API Security
- API Key în header (nu în URL)
- HTTPS only (SSL/TLS encryption)
- Rate limiting (max 1000 events/min per IP)
- Azure SQL firewall rules (doar Azure services)

---

## 🚀 Scalability

### Performance Optimizations

**1. Database Indexes:**
```sql
-- Indexuri pe cele mai query-aite coloane
CREATE INDEX idx_user_timestamp ON user_events(user_id, timestamp DESC);
CREATE INDEX idx_slug ON user_events(slug);
CREATE INDEX idx_domain_slug ON user_events(domain, slug);
```

**2. Caching (Optional - Redis):**
```python
# Cache user profiles în Redis pentru 5 minute
@lru_cache(maxsize=10000)
def get_user_profile(user_id):
    # Retrieve from database
    pass
```

**3. Async Processing (Optional - Celery):**
```python
# Process events asynchron în background
@celery.task
def process_pageview_event(event_data):
    # Save to database
    pass
```

### Estimated Costs (Azure)

**Scenario:** 200 landing pages × 1000 visitors/day = 200,000 pageviews/day

| Service | Tier | Cost/month |
|---------|------|------------|
| Azure SQL Database | S1 (20 DTU) | ~$30 |
| Azure Web App | B1 Basic | ~$13 |
| **Total** | | **~$43/month** |

**Scale up:** Dacă traficul crește, upgrade la S2 (50 DTU) sau Web App B2

---

## ✅ Testing Checklist

- [ ] Generate fingerprint în browser console
- [ ] Verify fingerprint consistent pe refresh
- [ ] Test pageview tracking (check console logs)
- [ ] Test conversion tracking (check console logs)
- [ ] Verify events în Azure SQL `user_events` table
- [ ] Verify conversions în `conversions` table
- [ ] Test cross-domain: deschide 2 domenii, verify same user_id
- [ ] Test checkout link enhancement (inspect href attribute)
- [ ] Run analytics queries (check README queries)
- [ ] Load test: 1000 concurrent requests (use Apache Bench)

---

## 📞 Support & Maintenance

**Monitoring:**
- Azure Application Insights pentru backend monitoring
- Azure SQL Database metrics (DTU usage, query performance)
- Custom alerts pentru errors sau high latency

**Logs:**
```bash
# View backend logs
az webapp log tail --name userjourney-api --resource-group your-rg

# Download logs
az webapp log download --name userjourney-api --resource-group your-rg
```

**Backup:**
```sql
-- Azure SQL automatic backups (7-35 days retention)
-- Manual backup:
BACKUP DATABASE user_journey_tracker TO DISK = 'backup.bak';
```

---

**Built with ❤️ for tracking 200+ landing pages!**
