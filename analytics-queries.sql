-- ═══════════════════════════════════════════════════════════════════
-- User Journey Analytics - Useful SQL Queries
-- Copy-paste these queries în Azure Data Studio sau SSMS
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 1. OVERVIEW: Statistics generale
-- ───────────────────────────────────────────────────────────────────

-- Optimized: the two correlated subqueries each did a full scan of conversions;
-- folding them into one CROSS JOIN derived table scans conversions once instead of twice.
SELECT
    COUNT(DISTINCT ue.user_id) as total_unique_users,
    COUNT(DISTINCT ue.domain) as total_domains,
    COUNT(*) as total_pageviews,
    MAX(conv.total_conversions) as total_conversions,
    MAX(conv.total_revenue) as total_revenue
FROM user_events ue
CROSS JOIN (
    SELECT COUNT(*) as total_conversions, SUM(order_value) as total_revenue
    FROM conversions
) conv
WHERE ue.event_type = 'pageview'
  AND ue.timestamp >= DATEADD(day, -30, GETDATE());

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

-- Optimized: original scanned+filtered user_profiles twice (once per attribution model).
-- CROSS APPLY unpivots first_slug/last_slug so the filtered table is read once.
WITH filtered_profiles AS (
    SELECT first_slug, last_slug, total_revenue
    FROM user_profiles
    WHERE total_conversions > 0
      AND first_seen >= DATEADD(day, -30, GETDATE())
)
SELECT
    v.attribution_model,
    v.slug,
    COUNT(*) as conversions,
    SUM(fp.total_revenue) as revenue
FROM filtered_profiles fp
CROSS APPLY (VALUES ('First Touch', fp.first_slug), ('Last Touch', fp.last_slug)) v(attribution_model, slug)
GROUP BY v.attribution_model, v.slug
ORDER BY v.attribution_model, revenue DESC;

-- ───────────────────────────────────────────────────────────────────
-- 8. TIME TO CONVERSION: Cât durează până convertesc users?
-- ───────────────────────────────────────────────────────────────────

-- Optimized: original ran the user_profiles/conversions JOIN twice (once for the
-- detail list, once for the average). Materialize it once into a temp table and
-- query that twice instead.
IF OBJECT_ID('tempdb..#time_to_conversion') IS NOT NULL DROP TABLE #time_to_conversion;

SELECT
    up.user_id,
    up.first_slug,
    up.first_seen,
    c.timestamp as conversion_time,
    DATEDIFF(hour, up.first_seen, c.timestamp) as hours_to_conversion,
    up.total_pageviews as pageviews_before_conversion,
    c.order_value
INTO #time_to_conversion
FROM user_profiles up
JOIN conversions c ON up.user_id = c.user_id
WHERE c.timestamp >= DATEADD(day, -30, GETDATE());

SELECT * FROM #time_to_conversion ORDER BY hours_to_conversion ASC;

-- Average time to conversion
SELECT
    AVG(hours_to_conversion) as avg_hours_to_conversion,
    AVG(pageviews_before_conversion) as avg_pageviews_before_conversion
FROM #time_to_conversion;

DROP TABLE #time_to_conversion;

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

-- Fixed + optimized: the original joined pageviews to conversions by date only
-- (no user_id), producing a cartesian product per day (every pageview row paired
-- with every conversion row from that day). That inflated total_pageviews (x number
-- of conversions that day) and revenue (x number of pageviews that day).
-- unique_visitors / conversions / conversion_rate were unaffected since they used
-- COUNT(DISTINCT ...), which happens to dedupe the fan-out away.
-- Pre-aggregating each side by day before joining 1:1 fixes both and is also faster
-- (no row multiplication to compute or discard).
WITH pageviews_by_day AS (
    SELECT
        CAST(timestamp AS DATE) as date,
        COUNT(DISTINCT user_id) as unique_visitors,
        COUNT(*) as total_pageviews
    FROM user_events
    WHERE event_type = 'pageview'
      AND timestamp >= DATEADD(day, -30, GETDATE())
    GROUP BY CAST(timestamp AS DATE)
),
conversions_by_day AS (
    SELECT
        CAST(timestamp AS DATE) as date,
        COUNT(DISTINCT id) as conversions,
        COUNT(DISTINCT user_id) as converting_users,
        SUM(order_value) as revenue
    FROM conversions
    GROUP BY CAST(timestamp AS DATE)
)
SELECT
    p.date,
    p.unique_visitors,
    p.total_pageviews,
    ISNULL(c.conversions, 0) as conversions,
    c.revenue,
    CAST(ISNULL(c.converting_users, 0) AS FLOAT) / p.unique_visitors * 100 as conversion_rate
FROM pageviews_by_day p
LEFT JOIN conversions_by_day c ON p.date = c.date
ORDER BY p.date DESC;

-- ───────────────────────────────────────────────────────────────────
-- 11. DEVICE & BROWSER ANALYSIS: Ce device-uri convertesc cel mai bine?
-- ───────────────────────────────────────────────────────────────────

-- Fixed + optimized: the original joined every pageview row to every one of that
-- user's conversions (join on user_id only, no dedup), so a user with several
-- pageviews on a device fan-out-multiplied their order_value into "revenue" for
-- that device_type. total_users / converters / conversion_rate were unaffected
-- (COUNT DISTINCT dedupes the fan-out away). Deduping users-per-device and summing
-- each user's revenue once fixes it and is also cheaper (small deduped join vs. a
-- full pageview x conversion fan-out).
WITH user_devices AS (
    SELECT DISTINCT
        e.user_id,
        CASE
            WHEN e.user_agent LIKE '%Mobile%' THEN 'Mobile'
            WHEN e.user_agent LIKE '%Tablet%' THEN 'Tablet'
            ELSE 'Desktop'
        END as device_type
    FROM user_events e
    WHERE e.event_type = 'pageview'
      AND e.timestamp >= DATEADD(day, -30, GETDATE())
      AND e.user_agent IS NOT NULL
),
user_revenue AS (
    SELECT user_id, SUM(order_value) as total_order_value
    FROM conversions
    GROUP BY user_id
)
SELECT
    ud.device_type,
    COUNT(DISTINCT ud.user_id) as total_users,
    COUNT(DISTINCT ur.user_id) as converters,
    CAST(COUNT(DISTINCT ur.user_id) AS FLOAT) / COUNT(DISTINCT ud.user_id) * 100 as conversion_rate,
    SUM(ur.total_order_value) as revenue
FROM user_devices ud
LEFT JOIN user_revenue ur ON ud.user_id = ur.user_id
GROUP BY ud.device_type
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
