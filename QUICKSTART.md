# ⚡ Quick Start - 5 Minute Setup

Setup complet în **5 minute**!

---

## 📦 Ce ai nevoie:

Pentru **tine** (frontend):
- [ ] Fișierul `app-core.js`
- [ ] API endpoint URL de la colegul tău de backend
- [ ] API key de la colegul tău

Pentru **colegul tău** (backend):
- [ ] Citește [API-SPECIFICATION.md](./API-SPECIFICATION.md) (are tot ce trebuie)

---

## 🚀 Setup în 3 pași

### STEP 1: Adaugă script-ul pe TOATE landing pages

```html
<!-- Config -->
<script>
window.AC_CONFIG = {
    API_ENDPOINT: 'https://your-backend.azurewebsites.net',  // De la colegul tău
    API_KEY: 'sk_live_abc123xyz',  // De la colegul tău
    CHECKOUT_DOMAINS: ['digistore24.com'],
    DEBUG_MODE: false  // pune true pentru testing
};
</script>

<!-- Tracker Script -->
<script src="https://cdn.yourdomain.com/app-core.js"></script>
<!-- SAU încarcă local: <script src="app-core.js"></script> -->
```

**Pune asta în:**
- Leadpages: Settings → HTML/CSS/JavaScript widget (head section)
- WordPress: theme header.php sau plugin WPCode
- HTML static: înainte de `</head>`

✅ **Gata! Pageview tracking pornește automat.**

---

### STEP 2: Track conversii pe Thank You Page

După ce user-ul cumpără și ajunge pe thank you page:

```html
<script>
// Extrage order_id din URL (automat de la Digistore24)
const urlParams = new URLSearchParams(window.location.search);
const orderId = urlParams.get('order') || urlParams.get('oid');

// Track conversion
if (orderId) {
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

✅ **Gata! Tracking conversii funcționează.**

---

### STEP 3: Test

**Test 1: Pageviews**
1. Pune `DEBUG_MODE: true` în config
2. Deschide o landing page
3. F12 → Console
4. Vezi: `[AppCore] Event sent successfully`

**Test 2: Cross-domain (cel mai important!)**
1. Vizitează `domain1.com` → F12 → Console → Copiază `user_id`
2. Vizitează `domain2.net` → F12 → Console → Compară `user_id`
3. **user_id trebuie să fie ACELaȘI!** ✅

**Test 3: Conversion**
1. Click pe link către checkout
2. Verifică că URL are `?uid=...` adăugat automat
3. Pe thank you page → Console → Vezi `Conversion tracked`

---

## 🎯 Ce se întâmplă acum:

1. **User vizitează domain1.com** (din FB ad `amish-fire-cider`)
   - Fingerprint generat: `a3f5b8c9...`
   - Tracked în DB: pageview

2. **User vizitează domain2.net** (alt FB ad `parasite-flush`)
   - **SAME fingerprint**: `a3f5b8c9...`
   - Tracked în DB: pageview (same user!)

3. **User convertește pe Digistore24**
   - Conversion tracked cu `user_id: a3f5b8c9...`
   - **Știi exact câte domenii a vizitat înainte să cumpere!**

---

## 📊 Analytics (după ce backend e setat)

În Azure SQL Database, poți rula:

```sql
-- Top FB ads by conversions
SELECT first_touch_slug, COUNT(*) conversions, SUM(total_revenue) revenue
FROM user_profiles
WHERE total_conversions > 0
GROUP BY first_touch_slug
ORDER BY revenue DESC;

-- Users care au vizitat 2+ domenii dar nu au convertit (retargeting)
SELECT user_id, domains_visited
FROM user_profiles
WHERE total_conversions = 0 AND (SELECT COUNT(*) FROM OPENJSON(domains_visited)) >= 2;
```

---

## 🔧 Troubleshooting

| Problemă | Soluție |
|----------|---------|
| **Nu văd logs în Console** | Activează `DEBUG_MODE: true` |
| **user_id diferit pe domenii diferite** | Browser fingerprinting poate varia dacă browser/device diferit |
| **CORS error** | Backend-ul trebuie să permită CORS (`Access-Control-Allow-Origin: *`) |
| **Link către checkout nu are uid** | Verifică că domeniul e în `CHECKOUT_DOMAINS` |

---

## 📄 Documentație completă

- **[README.md](./README.md)** - Documentație detaliată (pentru tine)
- **[API-SPECIFICATION.md](./API-SPECIFICATION.md)** - Specificație API (pentru colegul tău)

---

---

## ⚡ Quick Start (5 minute setup pentru testing)

### 1. Test Local (fără Azure)

```bash
# 1. Install Python dependencies
pip install fastapi uvicorn pyodbc

# 2. Run FastAPI local (fără database deocamdată)
python fastapi-backend.py

# Backend va rula pe: http://localhost:8000
```

### 2. Test Frontend Tracker

```bash
# 1. Deschide example-landing-page.html în browser
# 2. Deschide Developer Console (F12)
# 3. Activează debug mode:
UserJourneyTracker.config.DEBUG_MODE = true

# 4. Vezi logs:
# [UserJourneyTracker] User ID generated: abc123...
# [UserJourneyTracker] Event "pageview" sent successfully
```

### 3. Test Conversion Tracking

```bash
# 1. Deschide example-thankyou-page.html
# 2. Adaugă parametri în URL:
# example-thankyou-page.html?order_id=TEST-001&order_value=47.00&product_name=Fire%20Cider

# 3. Vezi în console:
# ✅ Conversion tracked successfully!
```

---

## 🚀 Production Setup (Azure)

### Step 1: Azure SQL Database

```bash
# Create SQL Server + Database
az sql server create --name userjourney-sql --resource-group your-rg --location westeurope --admin-user sqladmin --admin-password YourPass123!
az sql db create --name user_journey_tracker --server userjourney-sql --resource-group your-rg --service-objective S0

# Enable firewall for Azure services
az sql server firewall-rule create --server userjourney-sql --resource-group your-rg --name AllowAzure --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
```

### Step 2: Run SQL Schema

```bash
# Connect to Azure SQL with Azure Data Studio
# Server: userjourney-sql.database.windows.net
# Database: user_journey_tracker
# User: sqladmin

# Run: azure-database-schema.sql
```

### Step 3: Deploy FastAPI

```bash
# Option A: Azure Web App
az webapp up --name userjourney-api --resource-group your-rg --runtime "PYTHON:3.11" --sku B1

# Set environment variables
az webapp config appsettings set --name userjourney-api --resource-group your-rg --settings \
  UJT_API_KEY="your-key" \
  AZURE_SQL_SERVER="userjourney-sql.database.windows.net" \
  AZURE_SQL_DATABASE="user_journey_tracker" \
  AZURE_SQL_USER="sqladmin" \
  AZURE_SQL_PASSWORD="YourPass123!"

# Option B: Using Docker
az acr create --name yourregistry --resource-group your-rg --sku Basic
az acr build --registry yourregistry --image userjourney-api:v1 .
az container create --resource-group your-rg --name userjourney-api --image yourregistry.azurecr.io/userjourney-api:v1 --cpu 1 --memory 1 --ports 8000 --environment-variables UJT_API_KEY=your-key AZURE_SQL_SERVER=... AZURE_SQL_DATABASE=... AZURE_SQL_USER=... AZURE_SQL_PASSWORD=...
```

### Step 4: Configure Tracker

Edit `user-journey-tracker.js`:
```javascript
const CONFIG = {
    API_ENDPOINT: 'https://userjourney-api.azurewebsites.net',
    API_KEY: 'your-secure-api-key',
    CHECKOUT_DOMAINS: ['digistore24.com'],
    DEBUG_MODE: false
};
```

### Step 5: Add to ALL Landing Pages

**În Leadpages** (Settings > Tracking Codes > Head Section):
```html
<script src="https://your-cdn.com/user-journey-tracker.js" defer></script>
```

**SAU inline:**
```html
<script>
// Copy-paste FULL user-journey-tracker.js content here
</script>
```

### Step 6: Add Conversion Tracking

Pe **Thank You Page**:
```html
<script src="https://your-cdn.com/user-journey-tracker.js" defer></script>
<script>
window.addEventListener('load', function() {
    if (window.UserJourneyTracker) {
        UserJourneyTracker.trackConversion({
            order_id: 'ORDER-123',
            product_name: 'Fire Cider',
            order_value: 47.00,
            currency: 'EUR'
        });
    }
});
</script>
```

---

## 📊 Analytics & Reports

### Open Azure Data Studio / SSMS and run:

```sql
-- Daily stats
SELECT * FROM v_daily_stats ORDER BY date DESC;

-- Top converting FB ads
SELECT * FROM v_conversion_by_slug ORDER BY conversion_rate DESC;

-- Cross-domain users (cei care vizitează 2+ landing pages)
SELECT * FROM v_cross_domain_users WHERE domains_visited >= 2;

-- Complete user journey
EXEC sp_get_user_journey @user_id = 'USER_ID_HERE';
```

**More queries:** Vezi `analytics-queries.sql` pentru toate query-urile utile!

---

## ✅ Checklist

- [ ] Azure SQL Database created & schema deployed
- [ ] FastAPI backend deployed pe Azure
- [ ] Backend health check OK: `https://your-api.azurewebsites.net/health`
- [ ] `user-journey-tracker.js` configurat cu API_ENDPOINT și API_KEY
- [ ] Script adăugat pe toate landing pages
- [ ] Conversion tracking adăugat pe Thank You Page
- [ ] Test: Vezi events în `user_events` table
- [ ] Test: Vezi conversions în `conversions` table

---

## 🐛 Troubleshooting

**Events nu apar în database?**
- Check console pentru erori (activează DEBUG_MODE)
- Verifică API_ENDPOINT și API_KEY
- Check Azure SQL firewall rules
- Test backend manual: `curl https://your-api.azurewebsites.net/health`

**User ID diferit pe fiecare domeniu?**
- Normal! Fingerprinting-ul poate varia ușor
- Backend face matching prin probabilistic matching

**Link-uri către checkout nu au ujt_uid?**
- Verifică că domeniul e în CHECKOUT_DOMAINS array
- Check că link-urile sunt `<a href="...">` tags
- Pentru JavaScript redirects, adaugă manual user_id

---

## 📞 Need Help?

1. Check backend logs: `az webapp log tail --name userjourney-api --resource-group your-rg`
2. Check database queries: Run analytics-queries.sql
3. Review README.md pentru detailed documentation

---

## 📁 Files Structure

```
user-journey-tracker/
├── user-journey-tracker.js          ← Frontend tracker (include pe toate landing pages)
├── fastapi-backend.py                ← Backend API (deploy pe Azure)
├── azure-database-schema.sql         ← Database schema (run în Azure SQL)
├── analytics-queries.sql             ← Useful SQL queries
├── requirements.txt                  ← Python dependencies
├── Dockerfile                        ← Docker deployment
├── .env.template                     ← Environment variables template
├── example-landing-page.html         ← Integration example
├── example-thankyou-page.html        ← Conversion tracking example
├── README.md                         ← Detailed documentation
└── QUICKSTART.md                     ← This file
```

---

## 🎉 Success!

Acum ai tracking complet cross-domain pentru toate landing-page-urile tale! 🚀

**Next:** Analizează datele și optimizează ad-urile cu conversion rate scăzut!
