-- ═══════════════════════════════════════════════════════════════════
-- User Journey Tracker - Azure SQL Database Schema
-- ═══════════════════════════════════════════════════════════════════

-- Database creation (run this first in Azure portal or via Azure CLI)
-- CREATE DATABASE user_journey_tracker;
-- GO

USE user_journey_tracker;
GO

-- ═══════════════════════════════════════════════════════════════════
-- TABLE: user_events (pageviews și alte events)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE user_events (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,

    -- User identification
    user_id VARCHAR(64) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,

    -- Event details
    event_type VARCHAR(50) NOT NULL, -- 'pageview', 'click', etc.
    timestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

    -- Page information
    domain VARCHAR(255) NOT NULL,
    page_url VARCHAR(2048) NOT NULL,
    page_title VARCHAR(500) NULL,

    -- Traffic source (FB ad slug și UTM)
    slug VARCHAR(255) NULL DEFAULT 'direct',
    utm_source VARCHAR(255) NULL,
    utm_medium VARCHAR(255) NULL,
    utm_campaign VARCHAR(255) NULL,
    utm_content VARCHAR(255) NULL,
    utm_term VARCHAR(255) NULL,
    fbclid VARCHAR(500) NULL,
    referrer VARCHAR(2048) NULL DEFAULT 'direct',

    -- Device information
    screen_resolution VARCHAR(50) NULL,
    viewport_size VARCHAR(50) NULL,
    user_agent VARCHAR(1000) NULL,

    -- Geographic (server-side IP lookup — ipapi.co)
    country VARCHAR(10) NULL,
    geo_region VARCHAR(150) NULL,
    geo_city VARCHAR(150) NULL,

    -- Cohort (stabil per campanie/device/limbă — util pentru Safari cross-domain)
    cohort_id VARCHAR(64) NULL,

    -- Metadata
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

    -- Indexes
    INDEX idx_user_id (user_id),
    INDEX idx_fingerprint (fingerprint),
    INDEX idx_timestamp (timestamp),
    INDEX idx_domain (domain),
    INDEX idx_slug (slug),
    INDEX idx_event_type (event_type),
    INDEX idx_user_timestamp (user_id, timestamp DESC),
    INDEX idx_cohort_id (cohort_id),
    INDEX idx_country (country)
);
GO

-- ═══════════════════════════════════════════════════════════════════
-- TABLE: conversions
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE conversions (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,

    -- User identification
    user_id VARCHAR(64) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,

    -- Conversion details
    timestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

    -- Page information
    domain VARCHAR(255) NOT NULL,
    page_url VARCHAR(2048) NOT NULL,
    page_title VARCHAR(500) NULL,

    -- Order information
    order_id VARCHAR(255) NULL,
    product_id VARCHAR(255) NULL,
    product_name VARCHAR(500) NULL,
    order_value DECIMAL(10, 2) NULL,
    currency VARCHAR(10) NULL DEFAULT 'EUR',

    -- Digistore24 specific
    digistore_order_id VARCHAR(255) NULL,
    digistore_product_id VARCHAR(255) NULL,
    custom_fields NVARCHAR(MAX) NULL, -- JSON format

    -- Attribution (first-touch from traffic source)
    slug VARCHAR(255) NULL DEFAULT 'direct',
    utm_source VARCHAR(255) NULL,
    utm_medium VARCHAR(255) NULL,
    utm_campaign VARCHAR(255) NULL,

    -- Geographic (server-side IP lookup)
    country VARCHAR(10) NULL,
    geo_region VARCHAR(150) NULL,
    geo_city VARCHAR(150) NULL,

    -- Cohort
    cohort_id VARCHAR(64) NULL,

    -- Metadata
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

    -- Indexes
    INDEX idx_user_id (user_id),
    INDEX idx_timestamp (timestamp),
    INDEX idx_order_id (order_id),
    INDEX idx_digistore_order_id (digistore_order_id),
    INDEX idx_slug (slug),
    INDEX idx_domain (domain),
    INDEX idx_cohort_id (cohort_id),
    INDEX idx_country (country)
);
GO

-- ═══════════════════════════════════════════════════════════════════
-- TABLE: custom_events
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE custom_events (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,

    -- User identification
    user_id VARCHAR(64) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,

    -- Event details
    timestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    domain VARCHAR(255) NOT NULL,
    page_url VARCHAR(2048) NOT NULL,

    -- Custom event data
    event_name VARCHAR(255) NOT NULL,
    event_data NVARCHAR(MAX) NULL, -- JSON format

    -- Metadata
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

    -- Indexes
    INDEX idx_user_id (user_id),
    INDEX idx_event_name (event_name),
    INDEX idx_timestamp (timestamp)
);
GO

-- ═══════════════════════════════════════════════════════════════════
-- TABLE: user_profiles (summary/aggregated data per user)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE user_profiles (
    user_id VARCHAR(64) PRIMARY KEY,
    fingerprint VARCHAR(64) NOT NULL,

    -- Timeline
    first_seen DATETIME2 NOT NULL,
    last_seen DATETIME2 NOT NULL,

    -- Statistics
    total_pageviews INT NOT NULL DEFAULT 0,
    total_conversions INT NOT NULL DEFAULT 0,
    total_revenue DECIMAL(10, 2) NULL DEFAULT 0,

    -- Domains visited (JSON array)
    domains_visited NVARCHAR(MAX) NULL,
    unique_domains_count INT NOT NULL DEFAULT 0,

    -- First touch attribution
    first_slug VARCHAR(255) NULL,
    first_utm_source VARCHAR(255) NULL,
    first_utm_campaign VARCHAR(255) NULL,
    first_domain VARCHAR(255) NULL,

    -- Last touch attribution
    last_slug VARCHAR(255) NULL,
    last_domain VARCHAR(255) NULL,

    -- Metadata
    updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

    -- Indexes
    INDEX idx_first_seen (first_seen),
    INDEX idx_last_seen (last_seen),
    INDEX idx_total_conversions (total_conversions),
    INDEX idx_unique_domains (unique_domains_count)
);
GO

-- ═══════════════════════════════════════════════════════════════════
-- VIEWS: Useful analytics views
-- ═══════════════════════════════════════════════════════════════════

-- View: Cross-domain users (users care au vizitat 2+ domenii)
CREATE VIEW v_cross_domain_users AS
SELECT
    user_id,
    COUNT(DISTINCT domain) as domains_visited,
    MIN(timestamp) as first_seen,
    MAX(timestamp) as last_seen,
    COUNT(*) as total_pageviews,
    STRING_AGG(DISTINCT domain, ', ') as domains_list
FROM user_events
WHERE event_type = 'pageview'
GROUP BY user_id
HAVING COUNT(DISTINCT domain) >= 2;
GO

-- View: Conversion funnel by slug
CREATE VIEW v_conversion_by_slug AS
SELECT
    e.slug,
    COUNT(DISTINCT e.user_id) as unique_users,
    COUNT(DISTINCT c.user_id) as converted_users,
    CAST(COUNT(DISTINCT c.user_id) AS FLOAT) / NULLIF(COUNT(DISTINCT e.user_id), 0) * 100 as conversion_rate,
    SUM(c.order_value) as total_revenue,
    AVG(c.order_value) as avg_order_value
FROM user_events e
LEFT JOIN conversions c ON e.user_id = c.user_id AND e.slug = c.slug
WHERE e.event_type = 'pageview'
GROUP BY e.slug;
GO

-- View: Daily statistics
CREATE VIEW v_daily_stats AS
SELECT
    CAST(timestamp AS DATE) as date,
    COUNT(*) as pageviews,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(DISTINCT domain) as unique_domains
FROM user_events
WHERE event_type = 'pageview'
GROUP BY CAST(timestamp AS DATE);
GO

-- ═══════════════════════════════════════════════════════════════════
-- STORED PROCEDURES: Pentru operații complexe
-- ═══════════════════════════════════════════════════════════════════

-- Procedure: Update user profile after new event
CREATE PROCEDURE sp_update_user_profile
    @user_id VARCHAR(64),
    @fingerprint VARCHAR(64),
    @timestamp DATETIME2,
    @domain VARCHAR(255),
    @slug VARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    -- Check if profile exists
    IF EXISTS (SELECT 1 FROM user_profiles WHERE user_id = @user_id)
    BEGIN
        -- Update existing profile
        UPDATE user_profiles
        SET
            last_seen = @timestamp,
            last_slug = @slug,
            last_domain = @domain,
            total_pageviews = total_pageviews + 1,
            updated_at = GETUTCDATE()
        WHERE user_id = @user_id;
    END
    ELSE
    BEGIN
        -- Create new profile
        INSERT INTO user_profiles (
            user_id, fingerprint, first_seen, last_seen,
            total_pageviews, first_slug, first_utm_source, first_domain,
            last_slug, last_domain
        )
        VALUES (
            @user_id, @fingerprint, @timestamp, @timestamp,
            1, @slug, NULL, @domain,
            @slug, @domain
        );
    END
END;
GO

-- Procedure: Update profile after conversion
CREATE PROCEDURE sp_update_user_profile_conversion
    @user_id VARCHAR(64),
    @order_value DECIMAL(10, 2)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE user_profiles
    SET
        total_conversions = total_conversions + 1,
        total_revenue = total_revenue + ISNULL(@order_value, 0),
        updated_at = GETUTCDATE()
    WHERE user_id = @user_id;
END;
GO

-- Procedure: Get complete user journey
CREATE PROCEDURE sp_get_user_journey
    @user_id VARCHAR(64)
AS
BEGIN
    SET NOCOUNT ON;

    -- User profile
    SELECT * FROM user_profiles WHERE user_id = @user_id;

    -- All pageviews
    SELECT
        'pageview' as event_type,
        timestamp,
        domain,
        page_url,
        page_title,
        slug,
        utm_source,
        utm_campaign,
        referrer
    FROM user_events
    WHERE user_id = @user_id AND event_type = 'pageview'

    UNION ALL

    -- All conversions
    SELECT
        'conversion' as event_type,
        timestamp,
        domain,
        page_url,
        NULL as page_title,
        slug,
        utm_source,
        utm_campaign,
        CAST(order_value AS VARCHAR) as referrer
    FROM conversions
    WHERE user_id = @user_id

    ORDER BY timestamp DESC;
END;
GO

-- ═══════════════════════════════════════════════════════════════════
-- TRIGGERS: Auto-update user profiles
-- ═══════════════════════════════════════════════════════════════════

-- Trigger: Update profile when new pageview is inserted
CREATE TRIGGER trg_user_events_insert
ON user_events
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @user_id VARCHAR(64);
    DECLARE @fingerprint VARCHAR(64);
    DECLARE @timestamp DATETIME2;
    DECLARE @domain VARCHAR(255);
    DECLARE @slug VARCHAR(255);

    SELECT
        @user_id = user_id,
        @fingerprint = fingerprint,
        @timestamp = timestamp,
        @domain = domain,
        @slug = slug
    FROM inserted
    WHERE event_type = 'pageview';

    IF @user_id IS NOT NULL
    BEGIN
        EXEC sp_update_user_profile
            @user_id, @fingerprint, @timestamp, @domain, @slug;
    END
END;
GO

-- Trigger: Update profile when conversion is inserted
CREATE TRIGGER trg_conversions_insert
ON conversions
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @user_id VARCHAR(64);
    DECLARE @order_value DECIMAL(10, 2);

    SELECT
        @user_id = user_id,
        @order_value = order_value
    FROM inserted;

    IF @user_id IS NOT NULL
    BEGIN
        EXEC sp_update_user_profile_conversion @user_id, @order_value;
    END
END;
GO

-- ═══════════════════════════════════════════════════════════════════
-- SAMPLE QUERIES: Exemple de query-uri utile
-- ═══════════════════════════════════════════════════════════════════

-- Query: Top 10 users cu cele mai multe pageviews
-- SELECT TOP 10 * FROM user_profiles ORDER BY total_pageviews DESC;

-- Query: Users care au convertit
-- SELECT * FROM user_profiles WHERE total_conversions > 0 ORDER BY total_revenue DESC;

-- Query: Multi-domain journey (users care au vizitat 3+ domenii)
-- SELECT * FROM v_cross_domain_users WHERE domains_visited >= 3 ORDER BY total_pageviews DESC;

-- Query: Conversion rate by slug (FB ad)
-- SELECT * FROM v_conversion_by_slug ORDER BY conversion_rate DESC;

-- Query: Daily trend (last 30 days)
-- SELECT * FROM v_daily_stats WHERE date >= DATEADD(day, -30, GETDATE()) ORDER BY date DESC;

-- Query: Find user journey by order_id
-- SELECT e.*, c.order_id, c.order_value
-- FROM conversions c
-- JOIN user_events e ON c.user_id = e.user_id
-- WHERE c.order_id = 'YOUR_ORDER_ID'
-- ORDER BY e.timestamp;

-- Query: Attribution analysis (care slug convertește cel mai bine)
-- SELECT
--     first_slug,
--     COUNT(*) as total_users,
--     SUM(total_conversions) as conversions,
--     AVG(CAST(total_conversions AS FLOAT)) as avg_conversions_per_user,
--     SUM(total_revenue) as revenue
-- FROM user_profiles
-- GROUP BY first_slug
-- ORDER BY revenue DESC;

-- ═══════════════════════════════════════════════════════════════════
-- INDEXES pentru performanță (adiționale dacă baza crește mult)
-- ═══════════════════════════════════════════════════════════════════

-- CREATE INDEX idx_domain_slug ON user_events(domain, slug, timestamp);
-- CREATE INDEX idx_user_conversion ON conversions(user_id, timestamp);
-- CREATE INDEX idx_slug_timestamp ON user_events(slug, timestamp) WHERE event_type = 'pageview';

-- ═══════════════════════════════════════════════════════════════════
-- DONE!
-- ═══════════════════════════════════════════════════════════════════
