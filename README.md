# 🚀 AppCore Analytics - Frontend Integration

## Introducere

Acest sistem îți permite să track-uiești utilizatorii individuali pe toate cele **200+ landing pages** (domenii diferite), să vezi user journey-ul lor cross-domain, și să identifici conversiile.

### 🎯 Ce face sistemul:

1. **Identificare utilizatori** - Browser fingerprinting consistent pe toate domeniile
2. **Track pageviews** - Fiecare vizită pe oricare landing page
3. **Track conversii** - Când userul convertește (de ex. pe Digistore24)
4. **Attribution** - Știi din ce FB ad (slug) a venit userul
5. **Cross-domain journey** - Vezi pe ce domenii a fost userul înainte de conversie
6. **Analytics** - Query-uri pentru optimization

---

## 📋 Setup Rapid

### Pentru tine (Frontend Developer):

1. **Adaugă script-ul pe toate landing pages:**

```html
<!-- STEP 1: Configure script-ul -->
<script>
// Modifică config înainte de a include tracker-ul
window.AC_CONFIG = {
    API_ENDPOINT: 'https://your-backend.azurewebsites.net',  // De la colegul tău
    API_KEY: 'your-api-key-here',  // De la colegul tău
    CHECKOUT_DOMAINS: ['digistore24.com'],
    DEBUG_MODE: false  // true pentru testing
};
</script>

<!-- STEP 2: Include tracker-ul -->
<script src="app-core.js"></script>
```

2. **Track conversii pe Thank You Page:**

```html
<script>
// Pe thank you page după cumpărare
AppCore.trackConversion({
    order_id: 'DS24-ORDER-12345',
    product_name: 'Amish Fire Cider Bundle',
    product_id: '12345',
    value: 47.00,
    currency: 'EUR'
});
</script>
```

**Gata! Tracking-ul pornește automat.**

---

### Pentru colegul tău (Backend Developer):

[![📡 Vezi API Specification completă](https://img.shields.io/badge/API-Specification-blue?style=for-the-badge)](./API-SPECIFICATION.md)

Trimite-i fișierul **[API-SPECIFICATION.md](./API-SPECIFICATION.md)** care conține:
- Toate endpoint-urile necesare (`/api/track/pageview`, `/api/track/conversion`, etc.)
- Structure exactă a request/response payload-urilor
- Recomandări pentru database schema
- CORS configuration
- Authentication
- Teste

---

## 🔧 Configurare Detaliată

### 1. Instalare pe Landing Pages (Leadpages, WordPress, etc.)

#### A. Hosting extern (recomandat pentru Leadpages):

**Upload `app-core.js` pe:**
- CDN (Cloudflare, AWS S3 + CloudFront)
- GitHub Pages
- Server-ul tău

**Apoi include în toate landing pages:**

```html
<script>
window.AC_CONFIG = {
    API_ENDPOINT: 'https://tracking-api.yourdomain.com',
    API_KEY: 'sk_live_abc123xyz789',
    CHECKOUT_DOMAINS: ['digistore24.com', 'thrivecart.com'],
    DEBUG_MODE: false
};
</script>
<script src="https://cdn.yourdomain.com/app-core.js"></script>
```

#### B. Inline în Leadpages (dacă e nevoie):

Copiază tot conținutul `app-core.js` și pune-l direct în **HTML/CSS/JavaScript** widget în Leadpages.

---

### 2. Configurare pentru Digistore24

Link-urile către checkout **vor fi enhanced automat** cu `uid` parameter:

**Înainte:**
```
https://www.digistore24.com/product/12345
```

**După (automat):**
```
https://www.digistore24.com/product/12345?uid=a3f5b8c9d2e1f4a6b7c8d9e0f1a2b3c4
```

Pe **Thank You Page** (după cumpărare), detectează parametrul din URL:

```html
<script>
// Extrage user_id din URL
const urlParams = new URLSearchParams(window.location.search);
const userId = urlParams.get('uid');
const orderId = urlParams.get('order') || urlParams.get('oid');

// Track conversion
if (userId && orderId) {
    AppCore.trackConversion({
        order_id: orderId,
        product_name: 'Amish Fire Cider Bundle',
        product_id: '12345',
        value: 47.00,
        currency: 'EUR'
    });
}
</script>
```

---

### 3. Tracking Custom Events (opțional)

Track orice acțiune dorești:

```javascript
// Click pe button
document.querySelector('#buy-button').addEventListener('click', function() {
    AppCore.trackEvent('button_click', {
        button_text: 'Cumpără Acum',
        button_position: 'hero-section'
    });
});

// Video play
document.querySelector('#vsl-video').addEventListener('play', function() {
    AppCore.trackEvent('video_play', {
        video_id: 'vimeo-12345',
        video_percentage: 0
    });
});

// Form submit
document.querySelector('#lead-form').addEventListener('submit', function() {
    AppCore.trackEvent('form_submit', {
        form_name: 'lead-magnet-form'
    });
});
```

---

## 🧪 Testing

### 1. Local Testing

Activează DEBUG_MODE:

```javascript
window.AC_CONFIG = {
    // ... alte configs
    DEBUG_MODE: true
};
```

Deschide Console (F12) și vezi:
```
[AppCore] Initializing...
[AppCore] User ID generated: a3f5b8c9d2e1f4a6...
[AppCore] Event sent successfully: {...}
```

### 2. Verifică Network Tab

În DevTools > Network, caută requests către:
- `POST /api/track/pageview`
- `POST /api/track/conversion`
- `POST /api/track/event`

### 3. Test Cross-Domain

1. Vizitează `domain1.com` → verific user_id în localStorage
2. Vizitează `domain2.net` → verifică că user_id e același (fingerprint)
3. Convertește pe thank you page → verifică că conversion e trimis cu user_id corect

---

## 📊 Analytics Queries

După ce backend-ul salvează datele, poți rula query-uri în Azure SQL:

```sql
-- Top performing FB ads (slugs)
SELECT
    first_touch_slug,
    COUNT(*) as users,
    SUM(total_conversions) as conversions,
    SUM(total_revenue) as revenue,
    ROUND(SUM(total_conversions) * 100.0 / COUNT(*), 2) as conversion_rate
FROM user_profiles
WHERE first_seen >= DATEADD(day, -30, GETUTCDATE())
GROUP BY first_touch_slug
ORDER BY revenue DESC;

-- Cross-domain journeys care convertesc
SELECT
    domains_visited,
    COUNT(*) as users,
    SUM(total_conversions) as conversions,
    AVG(total_revenue) as avg_revenue
FROM user_profiles
WHERE total_conversions > 0
GROUP BY domains_visited
ORDER BY conversions DESC;

-- Users care au vizitat 2+ domenii dar nu au convertit (retargeting audience)
SELECT
    user_id,
    domains_visited,
    first_touch_slug,
    last_seen
FROM user_profiles
WHERE JSON_QUERY(domains_visited) IS NOT NULL
    AND (SELECT COUNT(*) FROM OPENJSON(domains_visited)) >= 2
    AND total_conversions = 0
ORDER BY last_seen DESC;
```

---

## 🔐 Securitate & GDPR

### User ID = Browser Fingerprint

- **NU** salvăm IP-uri, email-uri sau date personale în frontend
- User ID este un **hash anonim** bazat pe caracteristici browser/device
- **GDPR compliant** - nu identificăm persoane, doar device-uri
- Backend-ul **poate** înregistra IP-uri (pentru geo-location) conform cu politica ta de privacy

### API Key Protection

- API Key-ul este vizibil în frontend (inevitabil)
- Backend-ul trebuie să aibă **rate limiting** și **validare** specifică
- Recomandare: Restricționează API key-ul la doar endpoint-urile de tracking (nu analytics)

---

## ❓ FAQ

### Q: Funcționează pe domenii complet diferite?
**A:** Da! Browser fingerprinting funcționează cross-domain. Același user va avea același fingerprint pe `domain1.com` și `domain2.net`.

### Q: Ce se întâmplă dacă backend-ul e offline?
**A:** Event-urile failed sunt salvate în localStorage și vor fi retrimise automat când backend-ul revine online (max 50 events).

### Q: Cum testez fără să afectez datele reale?
**A:** Folosește un API_ENDPOINT separat pentru testing sau adaugă un flag `test: true` în payload (și backend-ul să ignore acele events).

### Q: Funcționează cu AdBlockers?
**A:** Fingerprintingul funcționează, dar requests către backend pot fi blocate. Aproximativ 15-20% din useri au adblockers activi.

### Q: Pot track conversii de pe alte platforme (nu doar Digistore)?
**A:** Da! Doar adaugă domeniul în `CHECKOUT_DOMAINS` și implementează tracking pe thank you page-ul platformei.

---

## 📞 Support

Pentru întrebări despre:
- **Frontend integration** - contactează-mă (Marius)
- **Backend API** - vezi [API-SPECIFICATION.md](./API-SPECIFICATION.md)
- **Azure deployment** - colegul tău de backend

---

## 📄 Fișiere în acest proiect

| Fișier | Descriere | Pentru cine |
|--------|-----------|-------------|
| `app-core.js` | Script principal de tracking | **Frontend (tu)** |
| `API-SPECIFICATION.md` | Specificație completă API | **Backend (colegul tău)** |
| `README.md` | Documentație completă | **Ambii** |
| `QUICKSTART.md` | Setup rapid în 5 minute | **Ambii** |
| `example-landing-page.html` | Exemplu integrare landing page | **Frontend (tu)** |
| `example-thankyou-page.html` | Exemplu tracking conversie | **Frontend (tu)** |

---

**Happy Tracking! 🚀**

# Create Web App
az webapp up --name userjourney-api --resource-group your-rg --runtime "PYTHON:3.11" --sku B1

# Set environment variables
az webapp config appsettings set --name userjourney-api --resource-group your-rg --settings \
  UJT_API_KEY="your-secure-api-key-here" \
  AZURE_SQL_SERVER="userjourney-server.database.windows.net" \
  AZURE_SQL_DATABASE="user_journey_tracker" \
  AZURE_SQL_USER="sqladmin" \
  AZURE_SQL_PASSWORD="YourSecurePassword123!"
```

**Opțiunea B: Azure Container Instances**
```bash
# Build docker image
docker build -t userjourney-api .

# Push to Azure Container Registry
az acr create --name yourregistry --resource-group your-rg --sku Basic
az acr build --registry yourregistry --image userjourney-api:v1 .

# Deploy
az container create --resource-group your-rg --name userjourney-api --image yourregistry.azurecr.io/userjourney-api:v1 --cpu 1 --memory 1 --ports 8000
```

#### 1.4 Test Backend

După deployment, testează:
```bash
# Health check
curl https://userjourney-api.azurewebsites.net/health

# Răspuns așteptat:
# {"status":"healthy","database":"connected","timestamp":"2026-03-23T12:00:00"}
```

---

### STEP 2: Integrare Frontend (pe fiecare landing page)

#### 2.1 Modifică configurația în `user-journey-tracker.js`

Deschide `user-journey-tracker.js` și modifică:

```javascript
const CONFIG = {
    API_ENDPOINT: 'https://userjourney-api.azurewebsites.net', // ← URL-ul tău Azure
    API_KEY: 'your-secure-api-key-here', // ← API key-ul tău
    CHECKOUT_DOMAINS: ['digistore24.com'], // ← domeniile checkout
    DEBUG_MODE: false // true doar pentru testing
};
```

#### 2.2 Încarcă scriptul pe TOATE landing pages

**În Leadpages:**

1. Du-te la **Settings** > **Tracking Codes**
2. În secțiunea **Head Section**, adaugă:

```html
<!-- User Journey Tracker -->
<script src="https://your-cdn.com/app-core.js" defer></script>
```

**SAU direct inline (dacă nu ai CDN):**

```html
<script>
// Paste tot conținutul din app-core.js aici
</script>
```

**Important:** Acest script trebuie adăugat pe **FIECARE** din cele 200 landing pages!

---

### STEP 3: Track Conversii (pe Thank You Page)

#### 3.1 Pe Thank You Page de la Digistore24 (sau oriunde e conversia)

Adaugă acest cod:

```html
<script>
// Așteaptă să se încarce tracker-ul
window.addEventListener('load', function() {
    if (window.UserJourneyTracker) {
        // Track conversion
        UserJourneyTracker.trackConversion({
            order_id: 'ORDER-123456', // Digistore order ID
            product_id: 'PROD-001',
            product_name: 'Fire Cider - Amish Recipe',
            order_value: 47.00,
            currency: 'EUR',
            digistore_order_id: '123456',
            custom_fields: {
                // Orice alte date custom
                affiliate_id: 'AFF-123',
                upsell_taken: false
            }
        });

        console.log('Conversion tracked successfully!');
    }
});
</script>
```

#### 3.2 Parametri în URL către Digistore24

Tracker-ul AUTOMAT adaugă `ujt_uid` (user ID) în toate link-urile către checkout!

**Exemplu:**
- Link original: `https://www.digistore24.com/product/12345`
- Link modificat automat: `https://www.digistore24.com/product/12345?ujt_uid=abc123fingerprint`

În **Digistore24 Custom Fields**, configurează să primești `ujt_uid` din URL.

---

### STEP 4: Verificare că funcționează

#### 4.1 Test pe un landing page

1. Deschide un landing page în browser (mode incognito)
2. Deschide **Developer Tools** > **Console**
3. Activează debug mode temporar:
   ```javascript
   UserJourneyTracker.config.DEBUG_MODE = true;
   ```
4. Refresh page
5. Trebuie să vezi în consolă:
   ```
   [UserJourneyTracker] Initializing User Journey Tracker...
   [UserJourneyTracker] User ID generated: abc123...
   [UserJourneyTracker] Event "pageview" sent successfully
   ```

#### 4.2 Verifică în Database

Conectează-te la Azure SQL și rulează:

```sql
-- Vezi ultimele pageviews
SELECT TOP 10 * FROM user_events ORDER BY timestamp DESC;

-- Vezi dacă userul tău apare
SELECT * FROM user_events WHERE user_id = 'abc123...';
```

---

## 📊 Analytics & Queries

### Query 1: Cross-domain users (cei care au vizitat 2+ landing pages)

```sql
SELECT * FROM v_cross_domain_users
WHERE domains_visited >= 2
ORDER BY total_pageviews DESC;
```

### Query 2: Conversion rate by FB ad slug

```sql
SELECT * FROM v_conversion_by_slug
ORDER BY conversion_rate DESC;
```

### Query 3: Complete user journey

```sql
EXEC sp_get_user_journey @user_id = 'user-fingerprint-id';
```

### Query 4: Attribution analysis (ce slug convertește cel mai bine)

```sql
SELECT
    first_slug,
    COUNT(*) as total_users,
    SUM(total_conversions) as conversions,
    SUM(total_revenue) as revenue,
    AVG(total_revenue) as avg_revenue_per_user
FROM user_profiles
GROUP BY first_slug
ORDER BY revenue DESC;
```

### Query 5: Users care nu au convertit încă (retargeting)

```sql
SELECT
    user_id,
    first_slug,
    first_domain,
    domains_visited,
    total_pageviews,
    DATEDIFF(day, first_seen, GETDATE()) as days_since_first_visit
FROM user_profiles
WHERE total_conversions = 0
  AND total_pageviews >= 2
ORDER BY total_pageviews DESC;
```

---

## 🔥 Use Cases Avansate

### 1. Track evenimente custom (button clicks, video views, etc.)

```javascript
// Când userul dă click pe CTA button
document.getElementById('cta-button').addEventListener('click', function() {
    UserJourneyTracker.trackEvent('cta_clicked', {
        button_text: 'Buy Now',
        button_position: 'hero_section',
        page_scroll_depth: window.scrollY
    });
});

// Când userul ajunge la 50% din video
video.addEventListener('timeupdate', function() {
    if (video.currentTime / video.duration >= 0.5) {
        UserJourneyTracker.trackEvent('video_50_percent', {
            video_id: 'vimeo-123456',
            video_title: 'Fire Cider Benefits'
        });
    }
});
```

### 2. A/B Testing tracking

```javascript
// Track ce varianta de page vede userul
UserJourneyTracker.trackEvent('ab_test_variant', {
    test_name: 'headline_test_v1',
    variant: 'variant_b',
    headline: 'Discover the Amish Secret'
});
```

### 3. Retargeting pixel enhancement

Poți folosi `user_id`-ul pentru server-side retargeting:

```javascript
// Obține user ID
const userId = await UserJourneyTracker.getUserId();

// Trimite la server pentru Meta CAPI sau alte platforme
fetch('/retargeting-pixel', {
    method: 'POST',
    body: JSON.stringify({
        user_id: userId,
        event_type: 'page_view',
        fb_event_id: 'evt_' + Date.now()
    })
});
```

---

## 🛡️ Securitate & GDPR

### Cookie Banner Integration

Dacă folosești cookie banner (vezi folder `cookie-banner/`), adaugă tracking doar după consimțământ:

```javascript
// În cookie banner callback
function onCookieConsent(accepted) {
    if (accepted) {
        // Load tracker
        const script = document.createElement('script');
        script.src = 'https://your-cdn.com/app-core.js';
        document.head.appendChild(script);
    }
}
```

### Data Privacy

- **Fingerprinting** este GDPR compliant dacă este anonymizat (hash SHA-256)
- **Nu stochezi** PII (personal identifiable information) fără consimțământ
- **Oferă opt-out**: utilizatorii pot șterge localStorage pentru a reseta tracking

Adaugă pe site:
```javascript
// Opt-out function
function optOutTracking() {
    localStorage.clear();
    console.log('Tracking opt-out successful');
}
```

---

## 🚨 Troubleshooting

### Problema: Events nu apar în database

**Soluție:**
1. Check console pentru erori (activează `DEBUG_MODE: true`)
2. Verifică că API_ENDPOINT și API_KEY sunt corecte
3. Check CORS settings în FastAPI (poate blochează request-urile)
4. Verifică firewall-ul Azure SQL (trebuie să permită conexiuni din Azure Web App)

### Problema: User ID diferit pe fiecare domeniu

**Cauză:** Normal behavior - fingerprinting-ul poate varia puțin
**Soluție:** Sistemul funcționează prin matching probabilistic. Dacă vrei consistency 100%, folosește URL parameter passing între domenii (vezi secțiunea avansată).

### Problema: Link-urile către checkout nu sunt modificate

**Soluție:**
1. Verifică că domeniul checkout este în `CHECKOUT_DOMAINS` array
2. Check că link-urile sunt `<a href="...">` și nu butoane cu JavaScript redirect
3. Pentru butoane JavaScript, manual add user_id:

```javascript
function goToCheckout() {
    const userId = await UserJourneyTracker.getUserId();
    window.location.href = 'https://digistore24.com/product/123?ujt_uid=' + userId;
}
```

---

## 📦 Fișiere Necesare

```
user-journey-tracker/
├── app-core.js          ← Include pe toate landing pages
├── fastapi-backend.py                ← Deploy pe Azure
├── azure-database-schema.sql         ← Run în Azure SQL Database
├── requirements.txt                  ← Dependencies pentru FastAPI
├── Dockerfile (optional)             ← Pentru Container deployment
└── README.md                         ← Acest ghid
```

---

## 🎉 Next Steps

După ce sistemul este live:

1. **Monitorizare:** Urmărește datele primele 48h pentru erori
2. **Optimizare:** Analizează conversion rates by slug și optimizează ad-urile cu rate scăzut
3. **Retargeting:** Creează audiențe custom pentru userii care au vizitat 2+ domenii dar nu au convertit
4. **A/B Testing:** Testează variante de ad-uri și vezi care slug convertește cel mai bine

---

## 📞 Suport

Pentru întrebări sau probleme:
- Check logs în Azure Web App
- Verifică Azure SQL Database metrics
- Rulează health check endpoint: `https://your-api.azurewebsites.net/health`

**Success! 🚀**
