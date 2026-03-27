/**
 * AppCore Analytics - Node.js Backend
 * Azure SQL Database (ActiveDirectoryPassword auth)
 *
 * Endpoints:
 *   POST /api/events       → pageview tracking
 *   POST /api/conversions  → purchase/conversion tracking
 *   POST /api/actions      → custom events (view_content, checkout_initiated, etc.)
 *   GET  /api/p.gif        → image pixel fallback (ad blocker bypass)
 *   POST /api/b            → beacon API fallback
 *   GET  /api/journey/:id  → full user journey for dashboard
 *   GET  /health           → DB connectivity check
 */

'use strict';

const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

// ══════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════

const API_KEY = process.env.API_KEY || '';   // Gol = auth dezactivat
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const PORT = process.env.PORT || 8000;

const DB_CONFIG = {
	server: 'gb-ads-sql-server.database.windows.net',
	database: 'userTracker',
	authentication: {
		type: 'default',
		options: {
			userName: DB_USER,
			password: DB_PASSWORD
		}
	},
	options: {
		encrypt: true,
		trustServerCertificate: false,
		connectTimeout: 30000,
		port: 1433
	}
};

// 1x1 transparent GIF pixel
const PIXEL_GIF = Buffer.from(
	'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
	'base64'
);

// ══════════════════════════════════════════════════════════════════════
// APP + CORS
// ══════════════════════════════════════════════════════════════════════

const app = express();

app.use(cors({
	origin: '*',        // 200+ domenii - allow all
	methods: ['GET', 'POST', 'OPTIONS'],
	allowedHeaders: ['*']
}));

app.use(express.json());

// Servește fișierele din user-journey-tracker/ public
const path = require('path');
const PUBLIC_DIR = path.join(__dirname, '..');
app.use(express.static(PUBLIC_DIR, {
	setHeaders: (res, filePath) => {
		if (filePath.endsWith('.js')) {
			res.setHeader('Cache-Control', 'public, max-age=3600');
		}
	}
}));

// ══════════════════════════════════════════════════════════════════════
// DB POOL (persistent - nu se inchide per request)
// ══════════════════════════════════════════════════════════════════════

let pool = null;

async function getPool() {
	if (pool) return pool;
	pool = await new sql.ConnectionPool(DB_CONFIG).connect();
	pool.on('error', err => {
		console.error('[DB Pool] Error:', err.message);
		pool = null; // reset - se va reconecta la urmatorul request
	});
	console.log('[DB] Connected to Azure SQL');
	return pool;
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

function checkKey(req) {
	if (!API_KEY) return true;  // Auth dezactivat cand API_KEY nu e setat
	const xKey = req.headers['x-api-key'] || '';
	const auth = req.headers['authorization'] || '';
	const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
	const qKey = req.query.api_key || '';
	return (xKey || bearer || qKey) === API_KEY;
}

function parseTs(tsStr) {
	if (!tsStr) return new Date();
	const d = new Date(tsStr);
	return isNaN(d.getTime()) ? new Date() : d;
}

function genId(prefix) {
	return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

async function upsertProfile(db, {
	userId,
	isPageview = false,
	isConversion = false,
	slug = null,
	domain = null,
	country = null,
	deviceType = null,
	value = 0,
	ts
}) {
	const now = ts || new Date();

	const chk = db.request();
	chk.input('userId', sql.NVarChar(255), userId);
	const existing = await chk.query(
		'SELECT domains_visited FROM user_profiles WHERE user_id = @userId'
	);

	if (existing.recordset.length === 0) {
		// Prima vizita → INSERT
		const domains = JSON.stringify(domain ? [domain] : []);
		const r = db.request();
		r.input('userId', sql.NVarChar(255), userId);
		r.input('now', sql.DateTime2, now);
		r.input('pv', sql.Int, isPageview ? 1 : 0);
		r.input('cv', sql.Int, isConversion ? 1 : 0);
		r.input('rev', sql.Decimal(10, 2), isConversion ? (value || 0) : 0);
		r.input('domains', sql.NVarChar(sql.MAX), domains);
		r.input('slug', sql.NVarChar(500), slug);
		r.input('country', sql.NVarChar(100), country);
		r.input('deviceType', sql.NVarChar(50), deviceType);
		await r.query(`
            INSERT INTO user_profiles
                (user_id, first_seen, last_seen, total_pageviews, total_conversions,
                 total_revenue, domains_visited, first_touch_slug, last_touch_slug,
                 country, device_type, created_at, updated_at)
            VALUES
                (@userId, @now, @now, @pv, @cv, @rev, @domains, @slug, @slug,
                 @country, @deviceType, @now, @now)
        `);
	} else {
		// User existent → UPDATE
		let domList = [];
		try { domList = JSON.parse(existing.recordset[0].domains_visited || '[]'); } catch { }
		if (domain && !domList.includes(domain)) domList.push(domain);

		const r = db.request();
		r.input('userId', sql.NVarChar(255), userId);
		r.input('now', sql.DateTime2, now);
		r.input('domains', sql.NVarChar(sql.MAX), JSON.stringify(domList));

		if (isPageview) {
			r.input('slug', sql.NVarChar(500), slug);
			await r.query(`
                UPDATE user_profiles SET
                    last_seen       = @now,
                    total_pageviews = total_pageviews + 1,
                    last_touch_slug = CASE
                        WHEN @slug IS NOT NULL AND @slug <> 'direct'
                        THEN @slug
                        ELSE last_touch_slug
                    END,
                    domains_visited = @domains,
                    updated_at      = @now
                WHERE user_id = @userId
            `);
		} else if (isConversion) {
			r.input('value', sql.Decimal(10, 2), value || 0);
			await r.query(`
                UPDATE user_profiles SET
                    last_seen         = @now,
                    total_conversions = total_conversions + 1,
                    total_revenue     = COALESCE(total_revenue, 0) + @value,
                    updated_at        = @now
                WHERE user_id = @userId
            `);
		}
	}
}

// ══════════════════════════════════════════════════════════════════════
// ENDPOINT 1 — Pageview
// ══════════════════════════════════════════════════════════════════════

app.post('/api/events', async (req, res) => {
	if (!checkKey(req)) return res.status(401).json({ detail: 'Unauthorized' });

	const p = req.body;
	const ts = parseTs(p.timestamp);

	try {
		const db = await getPool();
		const r = db.request();

		r.input('userId', sql.NVarChar(255), p.user_id);
		r.input('domain', sql.NVarChar(255), p.domain || null);
		r.input('url', sql.NVarChar(2000), p.url || null);
		r.input('slug', sql.NVarChar(500), p.slug || null);
		r.input('referrer', sql.NVarChar(2000), p.referrer || null);
		r.input('utmSource', sql.NVarChar(255), p.utm_source || null);
		r.input('utmMedium', sql.NVarChar(255), p.utm_medium || null);
		r.input('utmCampaign', sql.NVarChar(500), p.utm_campaign || null);
		r.input('utmContent', sql.NVarChar(500), p.utm_content || null);
		r.input('utmTerm', sql.NVarChar(255), p.utm_term || null);
		r.input('utmId', sql.NVarChar(100), p.utm_id || null);
		r.input('fbclid', sql.NVarChar(500), p.fbclid || null);
		r.input('deviceType', sql.NVarChar(50), p.device_type || null);
		r.input('browser', sql.NVarChar(100), p.browser || null);
		r.input('os', sql.NVarChar(100), p.os || null);
		r.input('screenRes', sql.NVarChar(50), p.screen_resolution || null);
		r.input('language', sql.NVarChar(50), p.language || null);
		r.input('country', sql.NVarChar(100), p.country || null);
		r.input('ts', sql.DateTime2, ts);

		await r.query(`
            INSERT INTO user_events
                (user_id, event_type, domain, url, slug, referrer,
                 utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, fbclid,
                 device_type, browser, os, screen_resolution, language, country, timestamp)
            VALUES
                (@userId, 'pageview', @domain, @url, @slug, @referrer,
                 @utmSource, @utmMedium, @utmCampaign, @utmContent, @utmTerm, @utmId, @fbclid,
                 @deviceType, @browser, @os, @screenRes, @language, @country, @ts)
        `);

		await upsertProfile(db, {
			userId: p.user_id, isPageview: true,
			slug: p.slug, domain: p.domain,
			country: p.country, deviceType: p.device_type, ts
		});

	} catch (e) {
		console.error('[/api/events] ERROR:', e.message);
	}

	return res.status(201).json({ success: true, event_id: genId('evt') });
});

// ══════════════════════════════════════════════════════════════════════
// ENDPOINT 2 — Conversion (Purchase)
// ══════════════════════════════════════════════════════════════════════

app.post('/api/conversions', async (req, res) => {
	if (!checkKey(req)) return res.status(401).json({ detail: 'Unauthorized' });

	const p = req.body;
	const ts = parseTs(p.timestamp);
	const uid = p.tracking_user_id || p.user_id;

	try {
		const db = await getPool();

		// Skip duplicate order_id
		const dupR = db.request();
		dupR.input('orderId', sql.NVarChar(255), p.order_id);
		const dup = await dupR.query('SELECT id FROM conversions WHERE order_id = @orderId');
		if (dup.recordset.length > 0) {
			return res.status(201).json({ success: true, note: 'duplicate_skipped' });
		}

		// Calculeaza time_to_conversion daca nu vine din frontend
		let ttc = p.time_to_conversion_minutes ?? null;
		if (ttc === null) {
			const ttcR = db.request();
			ttcR.input('uid', sql.NVarChar(255), uid);
			const firstPv = await ttcR.query(`
                SELECT TOP 1 timestamp FROM user_events
                WHERE user_id = @uid AND event_type = 'pageview'
                ORDER BY timestamp ASC
            `);
			if (firstPv.recordset.length > 0 && firstPv.recordset[0].timestamp) {
				const diff = ts - new Date(firstPv.recordset[0].timestamp);
				ttc = Math.max(0, Math.floor(diff / 60000));
			}
		}

		// Ia first-touch slug daca nu vine din frontend
		let slug = p.attribution_slug || null;
		if (!slug) {
			const slugR = db.request();
			slugR.input('uid', sql.NVarChar(255), uid);
			const firstSlug = await slugR.query(`
                SELECT TOP 1 slug FROM user_events
                WHERE user_id = @uid AND event_type = 'pageview'
                  AND slug IS NOT NULL AND slug <> 'direct'
                ORDER BY timestamp ASC
            `);
			if (firstSlug.recordset.length > 0) slug = firstSlug.recordset[0].slug;
		}

		const r = db.request();
		r.input('uid', sql.NVarChar(255), uid);
		r.input('orderId', sql.NVarChar(255), p.order_id || null);
		r.input('productName', sql.NVarChar(500), p.product_name || null);
		r.input('productId', sql.NVarChar(100), p.product_id || null);
		r.input('value', sql.Decimal(10, 2), p.value || 0);
		r.input('currency', sql.NVarChar(10), p.currency || 'EUR');
		r.input('domain', sql.NVarChar(255), p.domain || null);
		r.input('slug', sql.NVarChar(500), slug);
		r.input('ttc', sql.Int, ttc);
		r.input('ts', sql.DateTime2, ts);

		await r.query(`
            INSERT INTO conversions
                (user_id, order_id, product_name, product_id, value, currency,
                 domain, attribution_slug, time_to_conversion_minutes, timestamp)
            VALUES
                (@uid, @orderId, @productName, @productId, @value, @currency,
                 @domain, @slug, @ttc, @ts)
        `);

		await upsertProfile(db, { userId: uid, isConversion: true, value: p.value || 0, ts });

	} catch (e) {
		console.error('[/api/conversions] ERROR:', e.message);
	}

	return res.status(201).json({ success: true, conversion_id: genId('conv') });
});

// ══════════════════════════════════════════════════════════════════════
// ENDPOINT 3 — Custom Events (view_content, checkout_initiated, etc.)
// ══════════════════════════════════════════════════════════════════════

app.post('/api/actions', async (req, res) => {
	if (!checkKey(req)) return res.status(401).json({ detail: 'Unauthorized' });

	const p = req.body;
	const ts = parseTs(p.timestamp);

	// event_name se stocheaza in metadata JSON (user_events nu are coloana event_name)
	const meta = Object.assign({}, p.metadata || {});
	if (p.event_name) meta.event_name = p.event_name;

	try {
		const db = await getPool();
		const r = db.request();

		r.input('userId', sql.NVarChar(255), p.user_id);
		r.input('eventType', sql.NVarChar(100), p.event_type || 'custom_event');
		r.input('domain', sql.NVarChar(255), p.domain || null);
		r.input('url', sql.NVarChar(2000), p.url || null);
		r.input('ts', sql.DateTime2, ts);
		r.input('meta', sql.NVarChar(sql.MAX), Object.keys(meta).length ? JSON.stringify(meta) : null);

		await r.query(`
            INSERT INTO user_events (user_id, event_type, domain, url, timestamp, metadata)
            VALUES (@userId, @eventType, @domain, @url, @ts, @meta)
        `);

	} catch (e) {
		console.error('[/api/actions] ERROR:', e.message);
	}

	return res.status(201).json({ success: true, event_id: genId('evt') });
});

// ══════════════════════════════════════════════════════════════════════
// ENDPOINT 4 — Image Pixel Fallback (ad blocker bypass)
// ══════════════════════════════════════════════════════════════════════

app.get('/api/p.gif', async (req, res) => {
	const noCache = {
		'Cache-Control': 'no-cache, no-store, must-revalidate',
		'Pragma': 'no-cache',
		'Expires': '0'
	};

	const { user_id, domain, url, slug, api_key,
		event_type = 'pageview',
		event_name = null,
		event_source = 'pixel',
		product_id = null } = req.query;

	const pixelKeyOk = !API_KEY || api_key === API_KEY;
	if (!pixelKeyOk || !user_id) {
		return res.set(noCache).type('image/gif').send(PIXEL_GIF);
	}

	const ts = new Date();
	const meta = { event_source };
	if (event_name) meta.event_name = event_name;
	if (product_id) meta.product_id = product_id;

	try {
		const db = await getPool();
		const r = db.request();

		r.input('userId', sql.NVarChar(255), user_id);
		r.input('eventType', sql.NVarChar(100), event_type);
		r.input('domain', sql.NVarChar(255), domain || null);
		r.input('url', sql.NVarChar(2000), url || null);
		r.input('slug', sql.NVarChar(500), slug || null);
		r.input('ts', sql.DateTime2, ts);
		r.input('meta', sql.NVarChar(sql.MAX), JSON.stringify(meta));

		await r.query(`
            INSERT INTO user_events (user_id, event_type, domain, url, slug, timestamp, metadata)
            VALUES (@userId, @eventType, @domain, @url, @slug, @ts, @meta)
        `);

		if (event_type === 'pageview') {
			await upsertProfile(db, { userId: user_id, isPageview: true, slug, domain, ts });
		}

	} catch (e) {
		console.error('[/api/p.gif] ERROR:', e.message);
	}

	return res.set(noCache).type('image/gif').send(PIXEL_GIF);
});

// ══════════════════════════════════════════════════════════════════════
// ENDPOINT 5 — Beacon API Fallback
// ══════════════════════════════════════════════════════════════════════

app.post('/api/b', async (req, res) => {
	// Intotdeauna 200 - Beacon API nu reincerca pe esec
	try {
		if (API_KEY && req.query.api_key !== API_KEY) return res.json({ success: true });

		const data = req.body;
		const uid = data.user_id;
		if (!uid) return res.json({ success: true });

		const ts = parseTs(data.timestamp);
		const event_type = data.event_type || 'pageview';
		const meta = { event_source: 'beacon' };
		if (data.event_name) meta.event_name = data.event_name;

		const db = await getPool();
		const r = db.request();

		r.input('userId', sql.NVarChar(255), uid);
		r.input('eventType', sql.NVarChar(100), event_type);
		r.input('domain', sql.NVarChar(255), data.domain || null);
		r.input('url', sql.NVarChar(2000), data.url || null);
		r.input('slug', sql.NVarChar(500), data.slug || null);
		r.input('ts', sql.DateTime2, ts);
		r.input('meta', sql.NVarChar(sql.MAX), JSON.stringify(meta));

		await r.query(`
            INSERT INTO user_events (user_id, event_type, domain, url, slug, timestamp, metadata)
            VALUES (@userId, @eventType, @domain, @url, @slug, @ts, @meta)
        `);

		if (event_type === 'pageview') {
			await upsertProfile(db, {
				userId: uid, isPageview: true,
				slug: data.slug, domain: data.domain, ts
			});
		}

	} catch (e) {
		console.error('[/api/b] ERROR:', e.message);
	}

	return res.json({ success: true, event_id: genId('evt') });
});

// ══════════════════════════════════════════════════════════════════════
// ENDPOINT 6 — User Journey (pentru dashboard)
// ══════════════════════════════════════════════════════════════════════

app.get('/api/journey/:user_id', async (req, res) => {
	if (!checkKey(req)) return res.status(401).json({ detail: 'Unauthorized' });

	const userId = req.params.user_id;
	const limit = Math.min(parseInt(req.query.limit) || 100, 500);

	try {
		const db = await getPool();

		const profileR = db.request();
		profileR.input('userId', sql.NVarChar(255), userId);
		const profileResult = await profileR.query(
			'SELECT * FROM user_profiles WHERE user_id = @userId'
		);

		const eventsR = db.request();
		eventsR.input('userId', sql.NVarChar(255), userId);
		eventsR.input('limit', sql.Int, limit);
		const eventsResult = await eventsR.query(`
            SELECT TOP (@limit) event_type, domain, url, slug, utm_content, timestamp, metadata
            FROM user_events
            WHERE user_id = @userId
            ORDER BY timestamp ASC
        `);

		const convR = db.request();
		convR.input('userId', sql.NVarChar(255), userId);
		const convResult = await convR.query(
			'SELECT * FROM conversions WHERE user_id = @userId ORDER BY timestamp ASC'
		);

		return res.json({
			user_id: userId,
			profile: profileResult.recordset[0] || {},
			events: eventsResult.recordset,
			conversions: convResult.recordset
		});

	} catch (e) {
		console.error('[/api/journey] ERROR:', e.message);
		return res.status(500).json({ detail: 'Internal error' });
	}
});

// ══════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ══════════════════════════════════════════════════════════════════════

app.get('/health', async (req, res) => {
	let dbStatus;
	try {
		const db = await getPool();
		await db.request().query('SELECT 1 AS ok');
		dbStatus = 'connected';
	} catch (e) {
		dbStatus = `error: ${e.message}`;
	}
	return res.json({ status: 'ok', db: dbStatus, timestamp: new Date().toISOString() });
});

// ══════════════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
	console.log(`AppCore Analytics running on http://localhost:${PORT}`);
	console.log(`Health check: http://localhost:${PORT}/health`);
});
