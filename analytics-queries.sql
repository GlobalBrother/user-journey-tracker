-- ═══════════════════════════════════════════════════════════════════
-- User Journey Analytics - Useful SQL Queries
-- Copy-paste these queries în Azure Data Studio sau SSMS
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 1. OVERVIEW: Statistics generale
-- ───────────────────────────────────────────────────────────────────

SELECT
    COUNT(DISTINCT user_id) as total_unique_users,
    COUNT(DISTINCT domain) as total_domains,
    COUNT(*) as total_pageviews,
    (SELECT COUNT(*) FROM conversions) as total_conversions,
    (SELECT SUM(order_value) FROM conversions) as total_revenue
FROM user_events
WHERE event_type = 'pageview'
  AND timestamp >= DATEADD(day, -30, GETDATE());

-- ───────────────────────────────────────────────────────────────────
-- 2. TOP PERFORMERS: Care FB ads (slugs) convertesc cel mai bine?
-- ───────────────────────────────────────────────────────────────────

SELECT
    up.first_slug,
    COUNT(DISTINCT up.user_id) as total_users,
    SUM(up.total_conversions) as total_conversions,
    CAST(SUM(up.total_conversions) AS FLOAT) / COUNT(DISTINCT up.user_id) * 100 as conversion_rate,
    SUM(up.total_revenue) as total_revenue,
    AVG(up.total_revenue) as avg_revenue_per_user,
    AVG(up.total_pageviews) as avg_pageviews_per_user
FROM user_profiles up
WHERE up.first_seen >= DATEADD(day, -30, GETDATE())
GROUP BY up.first_slug
ORDER BY total_revenue DESC;

-- ───────────────────────────────────────────────────────────────────
-- 3. CROSS-DOMAIN JOURNEYS: Users care au vizitat multiple landing pages
-- ───────────────────────────────────────────────────────────────────

SELECT TOP 100
    user_id,
    domains_visited,
    total_pageviews,
    domains_list,
    first_seen,
    last_seen,
    DATEDIFF(hour, first_seen, last_seen) as journey_duration_hours
FROM v_cross_domain_users
WHERE domains_visited >= 2
ORDER BY total_pageviews DESC;

-- ───────────────────────────────────────────────────────────────────
-- 4. CONVERSION FUNNEL: Câți users ajung din pageview la conversie?
-- ───────────────────────────────────────────────────────────────────

WITH funnel AS (
    SELECT
        domain,
        COUNT(DISTINCT user_id) as total_visitors,
        COUNT(DISTINCT CASE WHEN total_conversions > 0 THEN user_id END) as converters,
        SUM(total_revenue) as revenue
    FROM user_profiles
    WHERE first_domain IS NOT NULL
      AND first_seen >= DATEADD(day, -30, GETDATE())
    GROUP BY first_domain
)
SELECT
    domain,
    total_visitors,
    converters,
    CAST(converters AS FLOAT) / total_visitors * 100 as conversion_rate,
    revenue,
    revenue / NULLIF(converters, 0) as avg_order_value
FROM funnel
ORDER BY conversion_rate DESC;

-- ───────────────────────────────────────────────────────────────────
-- 5. RETARGETING AUDIENCE: Users care nu au convertit (dar sunt activi)
-- ───────────────────────────────────────────────────────────────────

SELECT TOP 100
    user_id,
    first_slug,
    first_domain,
    domains_visited,
    total_pageviews,
    first_seen,
    last_seen,
    DATEDIFF(day, last_seen, GETDATE()) as days_since_last_visit
FROM user_profiles
WHERE total_conversions = 0
  AND total_pageviews >= 2
  AND last_seen >= DATEADD(day, -7, GETDATE())  -- Activi în ultimele 7 zile
ORDER BY total_pageviews DESC;

-- ───────────────────────────────────────────────────────────────────
-- 6. USER JOURNEY DETAILS: Journey complet pentru un user specific
-- ───────────────────────────────────────────────────────────────────

-- Înlocuiește 'USER_ID_HERE' cu user_id actual
DECLARE @user_id VARCHAR(64) = 'USER_ID_HERE';

-- Profile summary
SELECT * FROM user_profiles WHERE user_id = @user_id;

-- All events (pageviews + conversions) în ordine cronologică
SELECT
    'pageview' as event_type,
    timestamp,
    domain,
    page_url,
    slug,
    utm_source,
    utm_campaign,
    NULL as order_value
FROM user_events
WHERE user_id = @user_id

UNION ALL

SELECT
    'conversion' as event_type,
    timestamp,
    domain,
    page_url,
    slug,
    utm_source,
    utm_campaign,
    order_value
FROM conversions
WHERE user_id = @user_id

ORDER BY timestamp ASC;

-- ───────────────────────────────────────────────────────────────────
-- 7. ATTRIBUTION ANALYSIS: First-touch vs Last-touch
-- ───────────────────────────────────────────────────────────────────

SELECT
    'First Touch' as attribution_model,
    first_slug as slug,
    COUNT(*) as conversions,
    SUM(total_revenue) as revenue
FROM user_profiles
WHERE total_conversions > 0
  AND first_seen >= DATEADD(day, -30, GETDATE())
GROUP BY first_slug

UNION ALL

SELECT
    'Last Touch' as attribution_model,
    last_slug as slug,
    COUNT(*) as conversions,
    SUM(total_revenue) as revenue
FROM user_profiles
WHERE total_conversions > 0
  AND first_seen >= DATEADD(day, -30, GETDATE())
GROUP BY last_slug

ORDER BY attribution_model, revenue DESC;

-- ───────────────────────────────────────────────────────────────────
-- 8. TIME TO CONVERSION: Cât durează până convertesc users?
-- ───────────────────────────────────────────────────────────────────

SELECT
    up.user_id,
    up.first_slug,
    up.first_seen,
    c.timestamp as conversion_time,
    DATEDIFF(hour, up.first_seen, c.timestamp) as hours_to_conversion,
    up.total_pageviews as pageviews_before_conversion,
    c.order_value
FROM user_profiles up
JOIN conversions c ON up.user_id = c.user_id
WHERE c.timestamp >= DATEADD(day, -30, GETDATE())
ORDER BY hours_to_conversion ASC;

-- Average time to conversion
SELECT
    AVG(DATEDIFF(hour, up.first_seen, c.timestamp)) as avg_hours_to_conversion,
    AVG(up.total_pageviews) as avg_pageviews_before_conversion
FROM user_profiles up
JOIN conversions c ON up.user_id = c.user_id
WHERE c.timestamp >= DATEADD(day, -30, GETDATE());

-- ───────────────────────────────────────────────────────────────────
-- 9. BEST CONVERTING PATHS: Ce combinații de landing pages convertesc?
-- ───────────────────────────────────────────────────────────────────

WITH user_paths AS (
    SELECT
        user_id,
        STRING_AGG(domain, ' → ') WITHIN GROUP (ORDER BY timestamp) as journey_path
    FROM user_events
    WHERE event_type = 'pageview'
      AND timestamp >= DATEADD(day, -30, GETDATE())
    GROUP BY user_id
)
SELECT
    up.journey_path,
    COUNT(*) as users_count,
    SUM(CASE WHEN upr.total_conversions > 0 THEN 1 ELSE 0 END) as converters,
    CAST(SUM(CASE WHEN upr.total_conversions > 0 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 as conversion_rate
FROM user_paths up
JOIN user_profiles upr ON up.user_id = upr.user_id
GROUP BY up.journey_path
HAVING COUNT(*) >= 10  -- Minimum 10 users pentru pattern valid
ORDER BY conversion_rate DESC;

-- ───────────────────────────────────────────────────────────────────
-- 10. DAILY TREND: Evoluție zilnică (pageviews, conversii, revenue)
-- ───────────────────────────────────────────────────────────────────

SELECT
    CAST(e.timestamp AS DATE) as date,
    COUNT(DISTINCT e.user_id) as unique_visitors,
    COUNT(*) as total_pageviews,
    COUNT(DISTINCT c.id) as conversions,
    SUM(c.order_value) as revenue,
    CAST(COUNT(DISTINCT c.user_id) AS FLOAT) / COUNT(DISTINCT e.user_id) * 100 as conversion_rate
FROM user_events e
LEFT JOIN conversions c ON CAST(e.timestamp AS DATE) = CAST(c.timestamp AS DATE)
WHERE e.event_type = 'pageview'
  AND e.timestamp >= DATEADD(day, -30, GETDATE())
GROUP BY CAST(e.timestamp AS DATE)
ORDER BY date DESC;

-- ───────────────────────────────────────────────────────────────────
-- 11. DEVICE & BROWSER ANALYSIS: Ce device-uri convertesc cel mai bine?
-- ───────────────────────────────────────────────────────────────────

SELECT
    CASE
        WHEN user_agent LIKE '%Mobile%' THEN 'Mobile'
        WHEN user_agent LIKE '%Tablet%' THEN 'Tablet'
        ELSE 'Desktop'
    END as device_type,
    COUNT(DISTINCT e.user_id) as total_users,
    COUNT(DISTINCT c.user_id) as converters,
    CAST(COUNT(DISTINCT c.user_id) AS FLOAT) / COUNT(DISTINCT e.user_id) * 100 as conversion_rate,
    SUM(c.order_value) as revenue
FROM user_events e
LEFT JOIN conversions c ON e.user_id = c.user_id
WHERE e.event_type = 'pageview'
  AND e.timestamp >= DATEADD(day, -30, GETDATE())
  AND e.user_agent IS NOT NULL
GROUP BY
    CASE
        WHEN user_agent LIKE '%Mobile%' THEN 'Mobile'
        WHEN user_agent LIKE '%Tablet%' THEN 'Tablet'
        ELSE 'Desktop'
    END
ORDER BY conversion_rate DESC;

-- ───────────────────────────────────────────────────────────────────
-- 12. EXPORT DATA: Export pentru Power BI sau Excel
-- ───────────────────────────────────────────────────────────────────

-- Full export cu toate datele pentru dashboard extern
SELECT
    up.user_id,
    up.first_seen,
    up.last_seen,
    up.first_slug,
    up.first_utm_source,
    up.first_utm_campaign,
    up.first_domain,
    up.total_pageviews,
    up.total_conversions,
    up.total_revenue,
    up.unique_domains_count,
    DATEDIFF(day, up.first_seen, up.last_seen) as journey_duration_days,
    CASE
        WHEN up.total_conversions > 0 THEN 'Converted'
        WHEN up.last_seen >= DATEADD(day, -7, GETDATE()) THEN 'Active'
        ELSE 'Inactive'
    END as user_status
FROM user_profiles up
WHERE up.first_seen >= DATEADD(day, -90, GETDATE())
ORDER BY up.first_seen DESC;

-- ═══════════════════════════════════════════════════════════════════
-- DONE! Salvează acest fișier și folosește query-urile după nevoie
-- ═══════════════════════════════════════════════════════════════════
