/**
 * AppCore Analytics v1.0.1
 * Cross-Domain User Tracking for 200+ Landing Pages
 *
 * Features:
 * - Browser fingerprinting for consistent cross-domain identification
 * - localStorage caching per domain
 * - Automatic pageview tracking
 * - Conversion tracking
 * - FB ad parameter detection (slug)
 * - URL parameter enhancement for checkout links
 * - Direct API calls to FastAPI backend on Azure
 */

(function() {
	'use strict';

	// ═══════════════════════════════════════════════════════════════
	// CONFIGURATION - Modifică aceste valori
	// ═══════════════════════════════════════════════════════════════

	const CONFIG = {
		// URL-ul backend-ului (fără trailing slash)
		API_ENDPOINT: 'https://app-usertrackingapi-prod-5wzg9g.azurewebsites.net',

		// API Key injectat din pagină via window.AppCoreConfig.API_KEY
		API_KEY: (window.AppCoreConfig && window.AppCoreConfig.API_KEY) || '',

		// Domenii de checkout unde să adaugi user_id în URL
		CHECKOUT_DOMAINS: ['digistore24.com', 'checkout-ds24.com', 'thrivecart.com'],

		// Allowlist domenii legitime — pixelul nu trimite date dacă domeniul nu e în listă.
		// Previne zgomotul din WebView-uri Android (Telegram, Google app) sau preview Leadpages.
		// Lasă GOL [] pentru a dezactiva filtrarea (acceptă orice domeniu).
		ALLOWED_DOMAINS: [
			'www.forgottenhomeapothecary.com',
			'forgottenhomeapothecary.com',
			'www.buginguide.com',
			'buginguide.com',
			'www.theamishways.com',
			'theamishways.com',
			'www.theamishways.co.uk',
			'theamishways.co.uk',
			'nogridsurvivalprojects.com',
			'www.nogridsurvivalprojects.com',
			'advertorials645.lpages.co',
			'wildernesslongtermsurvival.com',
			'www.wildernesslongtermsurvival.com',
			'thelostskillsofindependence.com',
			'www.thelostskillsofindependence.com',
		],

		// Debug mode (activează console.logs)
		DEBUG_MODE: false
	};

	// ═══════════════════════════════════════════════════════════════
	// BROWSER FINGERPRINTING
	// ═══════════════════════════════════════════════════════════════

	/**
	 * Generează un fingerprint consistent bazat pe browser/device
	 * Acest fingerprint va fi același pe toate domeniile
	 */
	async function generateFingerprint() {
		const components = {
			// Screen
			screenResolution: `${screen.width}x${screen.height}`,
			screenDepth: screen.colorDepth,
			screenAvail: `${screen.availWidth}x${screen.availHeight}`,
			devicePixelRatio: window.devicePixelRatio || 1,

			// Browser
			userAgent: navigator.userAgent,
			languages: (navigator.languages || [navigator.language]).join(','),
			platform: navigator.platform,
			hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
			deviceMemory: navigator.deviceMemory || 'unknown',
			maxTouchPoints: navigator.maxTouchPoints || 0,

			// Timezone
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			timezoneOffset: new Date().getTimezoneOffset(),

			// Canvas fingerprint (mai precis)
			canvas: getCanvasFingerprint(),

			// WebGL fingerprint
			webgl: getWebGLFingerprint(),

			// Audio fingerprint (cel mai mare câștig de entropie)
			audio: await getAudioFingerprint(),

			// Fonts
			fonts: await detectFonts()
		};

		const fingerprintString = JSON.stringify(components);
		return await hashString(fingerprintString);
	}

	/**
	 * Canvas fingerprinting - foarte precis pentru identificare
	 */
	function getCanvasFingerprint() {
		try {
			const canvas = document.createElement('canvas');
			const ctx = canvas.getContext('2d');
			canvas.width = 200;
			canvas.height = 50;

			ctx.textBaseline = 'top';
			ctx.font = '14px Arial';
			ctx.fillStyle = '#f60';
			ctx.fillRect(125, 1, 62, 20);
			ctx.fillStyle = '#069';
			ctx.fillText('UserJourney🔍', 2, 15);
			ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
			ctx.fillText('Tracking', 4, 17);

			return canvas.toDataURL();
		} catch (e) {
			return 'canvas-not-available';
		}
	}

	/**
	 * WebGL fingerprinting
	 */
	function getWebGLFingerprint() {
		try {
			const canvas = document.createElement('canvas');
			const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
			if (!gl) return 'webgl-not-available';

			const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
			return {
				vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
				renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
			};
		} catch (e) {
			return 'webgl-error';
		}
	}

	/**
	 * Detectare fonts instalate (indicator bun pentru device)
	 */
	async function detectFonts() {
		const testFonts = [
			'Arial', 'Verdana', 'Times New Roman', 'Courier New',
			'Georgia', 'Palatino', 'Garamond', 'Bookman', 'Comic Sans MS',
			'Trebuchet MS', 'Impact'
		];

		const detectedFonts = [];

		for (const font of testFonts) {
			if (await isFontAvailable(font)) {
				detectedFonts.push(font);
			}
		}

		return detectedFonts.join(',');
	}

	/**
	 * Check dacă un font este disponibil
	 */
	async function isFontAvailable(fontName) {
		if (!document.fonts || !document.fonts.check) return false;
		return document.fonts.check(`12px "${fontName}"`);
	}

	/**
	 * Audio fingerprinting - entropie mare bazată pe hardware audio/driver
	 * Folosim 4096 samples (nu 44100) — entropie identică, de ~10x mai rapid pe mobile.
	 * Timeout de 500ms: dacă audio procesorul e blocat (iOS Safari strict mode, WebView),
	 * nu blocăm trackPageview() și pageview-ul se trimite la timp.
	 */
	async function getAudioFingerprint() {
		try {
			const AudioCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
			if (!AudioCtx) return 'audio-not-available';

			const ctx = new AudioCtx(1, 4096, 44100);
			const oscillator = ctx.createOscillator();
			const compressor = ctx.createDynamicsCompressor();

			oscillator.type = 'triangle';
			oscillator.frequency.value = 10000;
			compressor.threshold.value = -50;
			compressor.knee.value = 40;
			compressor.ratio.value = 12;
			compressor.attack.value = 0;
			compressor.release.value = 0.25;

			oscillator.connect(compressor);
			compressor.connect(ctx.destination);
			oscillator.start(0);

			const timeout = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('audio-timeout')), 500)
			);
			const buffer = await Promise.race([ctx.startRendering(), timeout]);
			const data = buffer.getChannelData(0);
			let sum = 0;
			// Citim primele 500 din cei 4096 samples (suficient pentru entropie)
			for (let i = 0; i < 500; i++) sum += Math.abs(data[i]);
			return sum.toFixed(10);
		} catch (e) {
			return 'audio-error';
		}
	}

	/**
	 * Hash string using SHA-256 (Web Crypto API)
	 */
	async function hashString(str) {
		const encoder = new TextEncoder();
		const data = encoder.encode(str);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	}

	/**
	 * Calculează cohort_id = SHA-256(utm_campaign|utm_source|utm_medium|timezone|device_type|language)
	 * Grupează useri din același audience chiar dacă user_id diferă (Safari, cross-domain).
	 */
	async function calculateCohortId(urlParams, deviceType, language) {
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
		const raw = [
			urlParams.utm_campaign || '',
			urlParams.utm_source   || '',
			urlParams.utm_medium   || '',
			timezone,
			deviceType             || '',
			language               || ''
		].join('|');
		return await hashString(raw);
	}

	// ═══════════════════════════════════════════════════════════════
	// USER ID MANAGEMENT
	// ═══════════════════════════════════════════════════════════════

	const STORAGE_KEY = 'ac_uid';
	const STORAGE_KEY_FIRST_SEEN = 'ac_first';

	let userId = null;
	let fingerprint = null;
	let fingerprintType = null; // 'persistent' = din localStorage, 'new' = generat acum
	let pageviewSent = false;
	let pageLoadStartTime = null;
	let scrollTrackingInitialized = false;
	let scrollSummarySent = false;
	let maxScrollPercent = 0;
	const scrollMilestoneTargets = [25, 50, 75, 90];
	const scrollMilestonesHit = new Set();

	/**
	 * Obține sau creează user ID.
	 * Setează fingerprintType: 'persistent' dacă userId exista în localStorage,
	 * 'new' dacă a fost generat acum (prima vizită sau după ștergere ITP).
	 */
	async function getUserId() {
		if (userId) return userId;

		// 1. Check localStorage — dacă există, îl folosim direct.
		// NU verificăm fingerprint match pe return visits: Safari 17+ adaugă noise
		// la Canvas per sesiune, deci fingerprint-ul se schimbă la fiecare vizită
		// și ar genera un user_id nou la fiecare return visit pe iOS Safari.
		const storedUserId = localStorage.getItem(STORAGE_KEY);
		if (storedUserId) {
			userId = storedUserId;
			fingerprintType = 'persistent';
			debugLog('User ID from localStorage:', userId);
			return userId;
		}

		// 2. Prima vizită pe acest domeniu (sau după ce ITP/utilizatorul a șters localStorage)
		// — generează fingerprint nou. Aceasta este o sesiune "new", fără identificare anterioară.
		// Pe iOS Safari cu ITP, localStorage poate fi șters după 7 zile de inactivitate,
		// deci același om poate reveni ca utilizator "new".
		fingerprint = await generateFingerprint();
		userId = fingerprint;
		fingerprintType = 'new';

		localStorage.setItem(STORAGE_KEY, userId);
		if (!localStorage.getItem(STORAGE_KEY_FIRST_SEEN)) {
			localStorage.setItem(STORAGE_KEY_FIRST_SEEN, new Date().toISOString());
		}

		debugLog('User ID generated (new):', userId);
		return userId;
	}

	// ═══════════════════════════════════════════════════════════════
	// FACEBOOK COOKIES (_fbp / _fbc)
	// ═══════════════════════════════════════════════════════════════

	/**
	 * Citește un cookie după nume.
	 * Returnează valoarea sau null dacă nu există / e blocat.
	 */
	function getCookie(name) {
		try {
			const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
			return match ? decodeURIComponent(match[1]) : null;
		} catch (e) {
			return null;
		}
	}

	/**
	 * Citește _fbp și _fbc — cookies setate de Facebook Pixel.
	 * _fbp: stabil per browser/domeniu (identificator de browser, supraviețuiește sesiunilor)
	 * _fbc: per click publicitar (prezent doar dacă userul a venit printr-un ad cu fbclid)
	 * Ambele pot lipsi dacă sunt blocate de browser, ad blocker sau iOS ITP.
	 */
	function getFbCookies() {
		return {
			fbp: getCookie('_fbp') || null,
			fbc: getCookie('_fbc') || null,
		};
	}

	// ═══════════════════════════════════════════════════════════════
	// URL PARAMETER DETECTION (FB Ads slug, UTM, etc)
	// ═══════════════════════════════════════════════════════════════

	/**
	 * Extrage parametri relevanți din URL
	 */
	function extractUrlParameters() {
		const urlParams = new URLSearchParams(window.location.search);

		// ⭐ IMPORTANT: utm_content identifică exact care ad creative/variation a fost folosit
		// Facebook Ad Link exemplu:
		// ...?utm_content=img-mada-fha-mus-ugly-remedy-amish-cough-syrup-140326+-+Copy
		// Aceasta e cea mai precisă identificare a sursei de trafic!

		const utmContent = urlParams.get('utm_content');

		return {
			// FB Ad slug - PRIORITIZEAZĂ utm_content (cel mai specific)
			// Fallback: source, slug, ad, sau 'direct'
		// Trunchiat la 490 chars pentru a evita erori de truncation în DB (coloana NVARCHAR(500))
		// fbclid prezent fără UTM-uri → trafic Facebook Ads fără tracking params
		// Salvăm 'fb-noutm-XXXXXXXX' (primele 8 chars din fbclid) ca slug unic per sesiune,
		// astfel putem identifica mai târziu că e Facebook Ads dar fără UTM configurat.
		// ACȚIUNE NECESARĂ: adaugă UTM params în reclamele Facebook care generează fbclid fără UTM!
		slug: (utmContent ||
		      urlParams.get('source') ||
		      urlParams.get('slug') ||
		      urlParams.get('ad') ||
		      (urlParams.get('fbclid') ? ('fb-noutm-' + urlParams.get('fbclid').substring(0, 8)) : null) ||
		      'direct').substring(0, 490),
			utm_source: urlParams.get('utm_source') || null,
			utm_medium: urlParams.get('utm_medium') || null,
			utm_campaign: urlParams.get('utm_campaign') || null,
			utm_content: utmContent || null,  // Ad creative specific
			utm_term: urlParams.get('utm_term') || null,
			utm_id: urlParams.get('utm_id') || null,

			// Facebook parameters
			fbclid: urlParams.get('fbclid') || null,

			// Referrer
			referrer: document.referrer || 'direct'
		};
	}

	/**
	 * Salvează parametri în localStorage pentru persistență pe domeniu.
	 * First-touch attribution — nu suprascrie dacă există deja un slug real.
	 * Excepție: dacă e stocat 'direct' și acum avem un slug real (UTM/fbclid),
	 * suprascrie — userul a vizitat înainte fără ad, acum vine prin ad.
	 */
	function saveTrafficSource(params) {
		const TRAFFIC_SOURCE_KEY = 'ac_source';
		const existing = localStorage.getItem(TRAFFIC_SOURCE_KEY);

		if (!existing) {
			localStorage.setItem(TRAFFIC_SOURCE_KEY, JSON.stringify(params));
			return;
		}

		// Suprascrie doar dacă: stored = 'direct' AND current = ceva real
		if (params.slug && params.slug !== 'direct') {
			try {
				const stored = JSON.parse(existing);
				if (stored.slug === 'direct') {
					localStorage.setItem(TRAFFIC_SOURCE_KEY, JSON.stringify(params));
				}
			} catch (e) {}
		}
	}

	/**
	 * Obține sursa de trafic (first-touch)
	 */
	function getTrafficSource() {
		const TRAFFIC_SOURCE_KEY = 'ac_source';
		const stored = localStorage.getItem(TRAFFIC_SOURCE_KEY);
		return stored ? JSON.parse(stored) : extractUrlParameters();
	}

	// ═══════════════════════════════════════════════════════════════
	// API COMMUNICATION - HYBRID MULTI-METHOD TRACKING
	// ═══════════════════════════════════════════════════════════════

	/**
	 * Fallback Method 1: Beacon API
	 * Funcționează chiar când user închide tab-ul sau navighează away
	 * Mai puțin blocat de ad blockers decât fetch()
	 * Folosește endpoint universal /api/b pentru toate tipurile de events
	 */
	function sendEventBeacon(endpoint, payload) {
		if (!navigator.sendBeacon) {
			debugLog('Beacon API not supported');
			return false;
		}

		// sendBeacon uses credentials mode "include" and can fail CORS on wildcard ACAO.
		// For cross-origin API endpoints, skip beacon and let other transports handle the event.
		try {
			if (new URL(CONFIG.API_ENDPOINT).origin !== window.location.origin) {
				debugLog('Beacon skipped on cross-origin endpoint (CORS credentials include)');
				return false;
			}
		} catch (_e) {}

		try {
			// Adaugă event_source pentru identificare în backend
			payload.event_source = 'beacon';

			// Beacon API acceptă doar FormData sau Blob
			const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
			// Folosește endpoint universal /api/b în loc de endpoint specific
			const url = `${CONFIG.API_ENDPOINT}/api/b?api_key=${CONFIG.API_KEY}`;

			const success = navigator.sendBeacon(url, blob);
			if (success) {
				debugLog('✅ Tracking via Beacon API - SUCCESS');
			}
			return success;
		} catch (error) {
			debugLog('Beacon API error:', error);
			return false;
		}
	}

	/**
	 * Fallback Method 2: Image Pixel
	 * Funcționează chiar dacă JavaScript e parțial blocat
	 * Extrem de greu de blocat (e doar un <img> tag)
	 * Folosește endpoint universal /api/p.gif pentru toate tipurile de events
	 */
	function sendEventPixel(endpoint, payload) {
		try {
			const img = new Image();
			const params = new URLSearchParams();

			// Adaugă event_source pentru identificare în backend
			payload.event_source = 'pixel';

			// Flatten payload pentru URL params
			Object.keys(payload).forEach(key => {
				const value = payload[key];
				params.append(key, typeof value === 'object' ? JSON.stringify(value) : value);
			});

			params.append('api_key', CONFIG.API_KEY);

			// Folosește endpoint universal /api/p.gif în loc de endpoint specific
			img.src = `${CONFIG.API_ENDPOINT}/api/p.gif?${params.toString()}`;
			img.style.display = 'none';
			img.width = 1;
			img.height = 1;

			// Adaugă în DOM pentru trigger request
			// Guard: document.body poate fi null dacă scriptul rulează din <head>
			// înainte ca browser-ul să fi procesat <body>
			const target = document.body || document.documentElement;
			target.appendChild(img);

			// Cleanup după 5 secunde
			setTimeout(() => {
				if (img.parentNode) {
					img.parentNode.removeChild(img);
				}
			}, 5000);

			debugLog('✅ Tracking via Pixel - SUCCESS (no confirmation)');
			return true;
		} catch (error) {
			debugLog('Pixel tracking error:', error);
			return false;
		}
	}

	/**
	 * Primary Method: Fetch API
	 * Cel mai modern și flexibil, dar poate fi blocat de ad blockers
	 */
	async function sendEventFetch(endpoint, payload) {
		const response = await fetch(`${CONFIG.API_ENDPOINT}${endpoint}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-API-Key': CONFIG.API_KEY
			},
			body: JSON.stringify(payload),
			keepalive: true // Important pentru requests when page unloads
		});

		if (!response.ok) {
			throw new Error(`API error: ${response.status}`);
		}

		return await response.json();
	}

	/**
	 * ROBUST Multi-Method Tracking cu cascade de fallback-uri
	 * Încearcă metodele în ordine până reușește una
	 * = ~95-98% success rate!
	 */
	async function sendEvent(endpoint, payload) {
		// METHOD 1: Try Fetch API (primary)
		try {
			const result = await sendEventFetch(endpoint, payload);
			debugLog('✅ Tracking via Fetch API - SUCCESS', result);
			return result;
		} catch (fetchError) {
			debugLog('❌ Fetch API failed:', fetchError.message);

			// METHOD 2: Try Beacon API (fallback 1)
			if (sendEventBeacon(endpoint, payload)) {
				return { success: true, method: 'beacon' };
			}

			// METHOD 3: Try Image Pixel (fallback 2)
			if (sendEventPixel(endpoint, payload)) {
				return { success: true, method: 'pixel' };
			}

			// METHOD 4: Save for later retry (fallback 3)
			debugLog('⚠️ All methods failed - saving for retry');
			saveFailedEvent(endpoint, payload);

			return { success: false, method: 'saved_for_retry' };
		}
	}

	/**
	 * Salvează event-uri failed pentru retry ulterior
	 */
	function saveFailedEvent(endpoint, payload) {
		const FAILED_EVENTS_KEY = 'ac_queue';
		const failed = JSON.parse(localStorage.getItem(FAILED_EVENTS_KEY) || '[]');

		failed.push({
			endpoint,
			payload,
			timestamp: new Date().toISOString()
		});

		// Păstrează max 50 failed events
		if (failed.length > 50) {
			failed.shift();
		}

		localStorage.setItem(FAILED_EVENTS_KEY, JSON.stringify(failed));
	}

	/**
	 * Retry failed events
	 */
	async function retryFailedEvents() {
		const FAILED_EVENTS_KEY = 'ac_queue';
		const failed = JSON.parse(localStorage.getItem(FAILED_EVENTS_KEY) || '[]');

		if (failed.length === 0) return;

		debugLog(`Retrying ${failed.length} failed events...`);

		for (const event of failed) {
			await sendEvent(event.endpoint, event.payload);
		}

		localStorage.removeItem(FAILED_EVENTS_KEY);
	}

	// ═══════════════════════════════════════════════════════════════
	// TRACKING FUNCTIONS
	// ═══════════════════════════════════════════════════════════════

	/**
	 * Trimite un eveniment page_exit via Beacon când userul iese de pe pagină.
	 * Beacon este singurul API disponibil în evenimentele de tip pagehide.
	 */
	function _sendPageExitEvent() {
		if (!pageLoadStartTime || !CONFIG.API_KEY) return;
		const secs = Math.round((Date.now() - pageLoadStartTime) / 1000);
		if (secs < 1) return;
		const uid = localStorage.getItem(STORAGE_KEY);
		if (!uid) return;

		// Avoid CORS noise: sendBeacon uses credentials include and is blocked for cross-origin wildcard ACAO.
		try {
			if (new URL(CONFIG.API_ENDPOINT).origin !== window.location.origin) return;
		} catch (_e) {}

		try {
			const payload = JSON.stringify({
				user_id: uid,
				event_type: 'custom_event',
				event_name: 'page_exit',
				domain: window.location.hostname,
				url: window.location.href,
				timestamp: new Date().toISOString(),
				event_source: 'beacon',
				metadata: { event_name: 'page_exit', time_on_page_seconds: secs }
			});
			navigator.sendBeacon(
				`${CONFIG.API_ENDPOINT}/api/b?api_key=${encodeURIComponent(CONFIG.API_KEY)}`,
				new Blob([payload], { type: 'application/json' })
			);
		} catch (e) { /* silently fail — page is being hidden */ }
	}

	function _detectPageType() {
		const path = (window.location.pathname || '').toLowerCase();
		if (/(upsell|downsell|oto|thank-you|thankyou)/.test(path)) return 'upsell';
		if (/(\/book\/|\/book$|\/lp\/|\/lander\/)/.test(path)) return 'lp';
		return 'other';
	}

	function _computeScrollPercent() {
		const doc = document.documentElement;
		const body = document.body;
		const viewport = Math.max(window.innerHeight || 0, doc ? doc.clientHeight : 0);
		const scrollTop = Math.max(window.pageYOffset || 0, doc ? doc.scrollTop || 0 : 0);
		const scrollHeight = Math.max(
			doc ? doc.scrollHeight || 0 : 0,
			body ? body.scrollHeight || 0 : 0,
			viewport
		);

		if (!scrollHeight || scrollHeight <= viewport + 4) return 100;
		const pct = Math.round(((scrollTop + viewport) / scrollHeight) * 100);
		return Math.max(0, Math.min(100, pct));
	}

	function _updateScrollTracking() {
		const pct = _computeScrollPercent();
		if (pct > maxScrollPercent) {
			maxScrollPercent = pct;
			scrollMilestoneTargets.forEach((target) => {
				if (pct >= target) scrollMilestonesHit.add(target);
			});
		}
	}

	function _sendScrollBehaviorSummary() {
		if (scrollSummarySent || !pageLoadStartTime || !CONFIG.API_KEY) return;
		scrollSummarySent = true;

		const uid = localStorage.getItem(STORAGE_KEY);
		if (!uid) return;

		_updateScrollTracking();
		const secs = Math.max(1, Math.round((Date.now() - pageLoadStartTime) / 1000));
		const firstTouch = getTrafficSource();
		const payload = {
			user_id: uid,
			event_type: 'custom_event',
			event_name: 'scroll_behavior_summary',
			domain: window.location.hostname,
			url: window.location.href,
			slug: firstTouch.slug,
			timestamp: new Date().toISOString(),
			metadata: {
				event_name: 'scroll_behavior_summary',
				page_type: _detectPageType(),
				max_scroll_percent: maxScrollPercent,
				milestones_hit: Array.from(scrollMilestonesHit).sort((a, b) => a - b),
				time_on_page_seconds: secs
			}
		};

		// Use fetch with keepalive=true — designed for pagehide/unload scenarios, works cross-origin.
		// sendEventBeacon is skipped for cross-origin and sendEventPixel fails during DOM freeze on pagehide.
		const beaconUrl = `${CONFIG.API_ENDPOINT}/api/b?api_key=${encodeURIComponent(CONFIG.API_KEY)}`;
		try {
			fetch(beaconUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				keepalive: true,
			}).catch(() => {});
		} catch (_e) {
			// Last-resort: direct beacon (may fail cross-origin on some browsers)
			try {
				navigator.sendBeacon && navigator.sendBeacon(beaconUrl, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
			} catch (_e2) {}
		}
	}

	function initScrollBehaviorTracking() {
		if (scrollTrackingInitialized) return;
		scrollTrackingInitialized = true;

		_updateScrollTracking();
		window.addEventListener('scroll', _updateScrollTracking, { passive: true });
		window.addEventListener('resize', _updateScrollTracking, { passive: true });
		window.addEventListener('pagehide', _sendScrollBehaviorSummary, { once: true });
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') _sendScrollBehaviorSummary();
		}, { passive: true });

		// Periodic early-capture: send scroll summary after 30s if user is still on page.
		// This ensures data is captured even when pagehide/visibilitychange don't fire reliably (mobile bfcache).
		setTimeout(() => {
			if (!scrollSummarySent && pageLoadStartTime) {
				_sendScrollBehaviorSummary();
			}
		}, 30000);
	}

	/**
	 * Track pageview (automat) - Conform API-SPECIFICATION.md
	 */
	async function trackPageview() {
		if (pageviewSent) return;
		pageviewSent = true;
		pageLoadStartTime = Date.now();

		const urlParams = extractUrlParameters();
		saveTrafficSource(urlParams);
		// Use first-touch UTMs from localStorage (persist across upsell pages that have no UTMs in URL)
		const firstTouch = getTrafficSource();

		// Detectează device type
		const deviceType = /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop';

		// Detectează browser
		const browser = detectBrowser();

		// Detectează OS
		const os = detectOS();

		const payload = {
			user_id: await getUserId(),  // Ensures localStorage is set before pagehide can fire
			fingerprint_type: fingerprintType,  // 'persistent' = known returning user, 'new' = first visit or ITP reset
			cohort_id: await calculateCohortId(firstTouch, deviceType, navigator.language),
			domain: window.location.hostname,
			url: window.location.href,
			// Folosește firstTouch.slug (din localStorage) nu urlParams.slug (din URL curent)
			// Pagina de upsell nu are UTM-uri în URL, deci urlParams.slug ar fi 'direct'
			slug: firstTouch.slug,
			referrer: document.referrer || null,
			timestamp: new Date().toISOString(),

			// UTM parameters — first-touch from localStorage (preserved across upsell pages)
			utm_source: firstTouch.utm_source,
			utm_medium: firstTouch.utm_medium,
			utm_campaign: firstTouch.utm_campaign,
			utm_content: firstTouch.utm_content,  // Ad creative specific
			utm_term: firstTouch.utm_term,
			utm_id: firstTouch.utm_id,            // Facebook Ad ID

			// Device/Browser info
			device_type: deviceType,
			browser: browser,
			os: os,
			screen_resolution: `${screen.width}x${screen.height}`,
			country: null, // Backend poate detecta din IP
			language: navigator.language,

			// Facebook specific
			fbclid: firstTouch.fbclid,

			// Facebook cookies — fallback de identificare când ac_uid lipsește
			// Pot fi null dacă sunt blocate de browser / ad blocker / iOS ITP
			...getFbCookies()
		};

		await sendEvent('/api/events', payload);

		// Register pagehide AFTER getUserId() has set localStorage — avoids race condition
		// where _sendPageExitEvent fires before the uid is stored
		window.addEventListener('pagehide', _sendPageExitEvent, { once: true });
	}

	/**
	 * Detectează browser
	 */
	function detectBrowser() {
		const ua = navigator.userAgent;
		if (ua.includes('Chrome')) return 'Chrome';
		if (ua.includes('Firefox')) return 'Firefox';
		if (ua.includes('Safari')) return 'Safari';
		if (ua.includes('Edge')) return 'Edge';
		return 'Unknown';
	}

	/**
	 * Detectează OS
	 */
	function detectOS() {
		const ua = navigator.userAgent;
		if (ua.includes('Windows')) return 'Windows';
		if (ua.includes('Mac')) return 'macOS';
		if (ua.includes('Linux')) return 'Linux';
		if (ua.includes('Android')) return 'Android';
		if (ua.includes('iOS')) return 'iOS';
		return 'Unknown';
	}

	/**
	 * Track conversie (manual call) - Conform API-SPECIFICATION.md
	 *
	 * Example usage:
	 * AppCore.trackConversion({
	 *   order_id: 'DS24-ORDER-12345',
	 *   product_name: 'Product Name',
	 *   product_id: '12345',
	 *   value: 47.00,
	 *   currency: 'EUR'
	 * });
	 */
	async function trackConversion(conversionData = {}) {
		const trafficSource = getTrafficSource();

		const urlParams = new URLSearchParams(window.location.search);
		const deviceType = /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop';

		// ── Recover original user_id ──────────────────────────────────
		// Strategy A: localStorage lookup via product_id (robust, nu depinde de ?custom=)
		// Digistore24 pasează ?digistore_initial_product_id= necriptat pe upsell/TY page.
		// La click pe butonul de checkout de pe LP, am salvat {user_id, slug} în
		// localStorage['ac_checkout_{productId}']. Îl citim acum.
		let trackingUserId = null;
		let recoveredSlug = null;

		const dsProductId = urlParams.get('digistore_initial_product_id')
			|| urlParams.get('product_id')
			|| conversionData.product_id
			|| null;

		if (dsProductId) {
			try {
				const stored = localStorage.getItem('ac_checkout_' + dsProductId);
				if (stored) {
					const parsed = JSON.parse(stored);
					trackingUserId = parsed.user_id || null;
					recoveredSlug  = parsed.slug   || null;
					debugLog('✅ Recovered user_id from localStorage checkout lookup:', trackingUserId, 'slug:', recoveredSlug);
					// Curăță după folosire — un order_id = o singură conversie
					localStorage.removeItem('ac_checkout_' + dsProductId);
				}
			} catch (e) {
				debugLog('⚠️ Failed to read checkout lookup from localStorage:', e);
			}
		}

		// Strategy B: ?custom= parameter (funcționează la CheckoutChamp, nu la Digistore24)
		// Digistore24 criptează ?custom= în forma ds24xxx..., deci îl ignorăm.
		if (!trackingUserId) {
			const customParam = urlParams.get('custom') || urlParams.get('tracking_id') || urlParams.get('tid');
			if (customParam && !customParam.startsWith('ds24')) {
				trackingUserId = customParam.split('---')[0].trim() || null;
			}
		}

		const payload = {
			user_id: await getUserId(),
			fingerprint_type: fingerprintType,  // 'persistent' = known returning user, 'new' = first visit or ITP reset
			tracking_user_id: trackingUserId,  // original visitor user_id from landing page
			cohort_id: await calculateCohortId(trafficSource, deviceType, navigator.language),
			order_id: conversionData.order_id || null,
			product_name: conversionData.product_name || null,
			product_id: conversionData.product_id || dsProductId || null,
			value: conversionData.value || 0,
			currency: conversionData.currency || 'EUR',
			domain: window.location.hostname,
			conversion_page: window.location.href,
			timestamp: new Date().toISOString(),
			// Folosește slug-ul recuperat din localStorage (cel mai precis),
			// sau first-touch din ac_source dacă nu e 'direct'.
			// Dacă ambele lipsesc / sunt 'direct', trimitem null → backend face attribution
			// prin Strategy 2 (checkout_initiated event) sau Strategy 3 (pageview slug match).
			attribution_slug: recoveredSlug || (trafficSource.slug !== 'direct' ? trafficSource.slug : null),
			time_to_conversion_minutes: (function() {
				try {
					const firstSeenIso = localStorage.getItem('ac_first');
					if (firstSeenIso) {
						const elapsedMs = Date.now() - new Date(firstSeenIso).getTime();
						if (elapsedMs > 0) return Math.round(elapsedMs / 60000);
					}
				} catch (e) {}
				return null;
			})()
		};

		await sendEvent('/api/conversions', payload);
	}

	/**
	 * Track custom event - Conform API-SPECIFICATION.md
	 *
	 * Example usage:
	 * AppCore.trackEvent('button_click', {button_text: 'Buy Now'});
	 * AppCore.trackEvent('video_play', {video_id: 'vimeo-12345'});
	 */
	async function trackEvent(eventName, eventData = {}) {
		const firstTouch = getTrafficSource();
		const payload = {
			user_id: await getUserId(),
			event_type: 'custom_event',
			event_name: eventName,
			domain: window.location.hostname,
			url: window.location.href,
			slug: firstTouch.slug,
			timestamp: new Date().toISOString(),
			metadata: eventData
		};

		await sendEvent('/api/actions', payload);
	}

	// ═══════════════════════════════════════════════════════════════
	// CHECKOUT LINK ENHANCEMENT
	// ═══════════════════════════════════════════════════════════════

	// ── Guard împotriva execuției concurente a enhanceCheckoutLinks ──
	// Pus pe window — shared între toate instanțele scriptului.
	if (window._acEnhancingCheckout === undefined) window._acEnhancingCheckout = false;

	// ── Pre-computed checkout button list ────────────────────────
	// Populated at window.load + after each LP re-render via MutationObserver.
	// Stores visible, non-sticky checkout buttons in DOM order.
	// Used at click time for button_position / button_total.
	if (!window._acPageCheckoutButtons) window._acPageCheckoutButtons = null;

	// URL patterns that identify a genuine checkout button.
	// More specific than CHECKOUT_DOMAINS — avoids counting footer links etc.
	const _CHECKOUT_BTN_PATTERNS = ['digistore24.com/content', 'checkout-ds24.com/content'];

	function _isCheckoutHref(href) {
		if (!href) return false;
		// Primary rule: explicit checkout provider URL patterns used by our funnels.
		if (_CHECKOUT_BTN_PATTERNS.some(p => href.includes(p))) return true;

		// Fallback rule: checkout domains, but only when URL carries a product-like id.
		// This avoids counting generic links ("here", placeholders, footer links) as buttons.
		const onCheckoutDomain = CONFIG.CHECKOUT_DOMAINS.some(domain => href.includes(domain));
		if (onCheckoutDomain && /(\d{6,})/.test(href)) return true;

		return false;
	}

	function _isElementVisible(el) {
		// Walk up the ancestor chain checking computed styles only.
		// We intentionally skip getBoundingClientRect: buttons below the fold or in
		// lazy-rendered Leadpages sections have rect={0,0} even though they are
		// genuinely present and will be visible once the user scrolls to them.
		// NOTE: opacity is NOT checked — Leadpages uses scroll-triggered CSS fade-in
		// animations (opacity: 0 → 1) on sections below the fold. At window.load,
		// those sections have opacity: 0 but the buttons are genuinely present.
		// Only display:none and visibility:hidden are intentional hiding (e.g. A/B variants).
		let node = el;
		while (node && node !== document.body) {
			const s = window.getComputedStyle(node);
			if (s.display === 'none' || s.visibility === 'hidden') return false;
			node = node.parentElement;
		}
		return true;
	}

	/**
	 * Returns the nearest "section-level" ancestor of el.
	 * Used to group A/B variant buttons that live in the same page section
	 * so only the visible variant is counted.
	 */
	function _nearestSection(el) {
		let node = el.parentElement;
		while (node && node !== document.body) {
			const tag = node.tagName.toUpperCase();
			const cls = (node.className && typeof node.className === 'string') ? node.className : '';
			const id  = node.id || '';
			if (
				tag === 'SECTION' ||
				/lp-section|page-section|section-container/i.test(cls) ||
				/^section/i.test(id)
			) return node;
			node = node.parentElement;
		}
		return document.body; // no section found → use body as fallback group
	}

	/**
	 * Build a stable DOM fingerprint for a clickable checkout element.
	 * This lets backend group clicks by physical button, even when
	 * two buttons share the same product_id and label.
	 */
	function _domFingerprint(el) {
		try {
			// 1) Best-case: Leadpages widget id is stable in page source and unique per button block.
			const widgetRoot = el.closest('[data-widget-id]');
			if (widgetRoot) {
				const wid = widgetRoot.getAttribute('data-widget-id');
				if (wid) return `wid:${wid}`;
			}

			// 2) Next best: explicit element IDs in source (common for image-link buttons).
			if (el.id) return `id:${el.id}`;
			const idRoot = el.closest('[id]');
			if (idRoot && idRoot.id) return `pid:${idRoot.id}`;

			// 3) Fallback: short structural path.
			const parts = [];
			let node = el;
			let depth = 0;
			while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body && depth < 6) {
				const tag = (node.tagName || 'x').toLowerCase();
				const parent = node.parentElement;
				let idx = 1;
				if (parent) {
					const sameTag = Array.from(parent.children).filter(c => c.tagName === node.tagName);
					idx = sameTag.indexOf(node) + 1;
				}
				parts.push(`${tag}:${idx}`);
				node = parent;
				depth += 1;
			}
			return `path:${parts.reverse().join('>')}`;
		} catch (_err) {
			return null;
		}
	}

	function _computeCheckoutButtonList() {
		// Use structured IDs added to all domain pages:
		// #buy-button-N containers hold numbered checkout button sections.
		// #hero-section holds the hero CTA button.
		// Sticky CTAs (.aw-sticky-cta-btn) are excluded — tracked separately.
		const result = [];

		// Collect from #buy-button-N containers (sorted by N)
		const buyContainers = Array.from(document.querySelectorAll('[id^="buy-button-"]'))
			.filter(el => /^buy-button-\d+$/.test(el.id))
			.sort((a, b) => {
				const na = parseInt(a.id.replace('buy-button-', ''), 10);
				const nb = parseInt(b.id.replace('buy-button-', ''), 10);
				return na - nb;
			});
		for (const container of buyContainers) {
			const links = Array.from(container.querySelectorAll('a[href]'))
				.filter(el => _isCheckoutHref(el.getAttribute('href') || ''))
				.filter(_isElementVisible);
			result.push(...links);
		}

		// Collect from #hero-section
		const heroSection = document.getElementById('hero-section');
		if (heroSection) {
			const heroLinks = Array.from(heroSection.querySelectorAll('a[href]'))
				.filter(el => _isCheckoutHref(el.getAttribute('href') || ''))
				.filter(_isElementVisible);
			result.push(...heroLinks);
		}

		return result;
	}

	function _getButtonPositionFromElement(element) {
		// Returns { position, isHero } for a checkout button element.
		// Sticky buttons are not passed here — they are handled separately.
		const buyContainer = element.closest('[id^="buy-button-"]');
		if (buyContainer && /^buy-button-\d+$/.test(buyContainer.id)) {
			return { position: parseInt(buyContainer.id.replace('buy-button-', ''), 10), isHero: false };
		}
		const heroSection = element.closest('#hero-section');
		if (heroSection) {
			return { position: 'hero', isHero: true };
		}
		return { position: null, isHero: false };
	}

	function _getCheckoutContainerIndicator(element) {
		const buyContainer = element.closest('[id^="buy-button-"]');
		if (buyContainer && /^buy-button-\d+$/.test(buyContainer.id)) {
			return { container_id: buyContainer.id, container_type: 'buy_button' };
		}
		if (element.closest('#hero-section')) {
			return { container_id: 'hero-section', container_type: 'hero' };
		}
		if (element.classList.contains('aw-sticky-cta-btn') || element.closest('.aw-sticky-cta-btn')) {
			return { container_id: 'aw-sticky-cta-btn', container_type: 'sticky' };
		}
		return { container_id: null, container_type: null };
	}

	function _extractProductIdFromCheckoutHref(href) {
		if (!href) return null;
		try {
			const parsed = new URL(href, window.location.origin);
			const m = parsed.pathname.match(/(\d{6,})/);
			return m ? m[1] : null;
		} catch (_err) {
			const fallback = String(href).match(/(\d{6,})/);
			return fallback ? fallback[1] : null;
		}
	}

	function _buildCheckoutButtonsInventory() {
		// Build inventory using structured IDs for deterministic positions.
		const entries = [];

		// Numbered buy-button sections
		const buyContainers = Array.from(document.querySelectorAll('[id^="buy-button-"]'))
			.filter(el => /^buy-button-\d+$/.test(el.id))
			.sort((a, b) => {
				const na = parseInt(a.id.replace('buy-button-', ''), 10);
				const nb = parseInt(b.id.replace('buy-button-', ''), 10);
				return na - nb;
			});
		for (const container of buyContainers) {
			const pos = parseInt(container.id.replace('buy-button-', ''), 10);
			const links = Array.from(container.querySelectorAll('a[href]'))
				.filter(el => _isCheckoutHref(el.getAttribute('href') || ''))
				.filter(_isElementVisible);
			for (const el of links) {
				entries.push({ el, position: pos });
			}
		}

		// Hero section
		const heroSection = document.getElementById('hero-section');
		if (heroSection) {
			const heroLinks = Array.from(heroSection.querySelectorAll('a[href]'))
				.filter(el => _isCheckoutHref(el.getAttribute('href') || ''))
				.filter(_isElementVisible);
			for (const el of heroLinks) {
				entries.push({ el, position: 'hero' });
			}
		}

		const total = entries.length;
		return entries.map(({ el, position }) => {
			const href = el.getAttribute('href') || el.getAttribute('data-widget-link') || null;
			const meta = _extractCheckoutButtonLabelAndKind(el);
			const indicator = _getCheckoutContainerIndicator(el);
			return {
				position: position,
				total: total,
				product_id: _extractProductIdFromCheckoutHref(href),
				button_label: meta.label,
				button_content_kind: meta.kind,
				button_dom_fingerprint: _domFingerprint(el),
				button_container_id: indicator.container_id,
				button_container_type: indicator.container_type,
				checkout_url: href,
			};
		});
	}

	async function _trackCheckoutButtonsInventory() {
		const buttons = _buildCheckoutButtonsInventory();
		const sig = JSON.stringify(buttons.map(b => [b.position, b.total, b.product_id || '', b.button_dom_fingerprint || '', b.checkout_url || '']));
		if (window._acLastButtonsInventorySig === sig) return;
		window._acLastButtonsInventorySig = sig;

		await trackEvent('checkout_buttons_inventory', {
			buttons: buttons,
			total_buttons: buttons.length,
			timestamp: Date.now(),
		});
	}

	function _extractCheckoutButtonLabelAndKind(el) {
		// STRICT extraction — only two scenarios are valid:
		//   1. <a>plain text</a> → use own visible text content as the label.
		//   2. <a><img alt="…"></a> → use the image's alt as the label.
		// No aria-label, no title, no src filenames, no parent/sibling fallbacks.

		const clean = (value) => {
			const text = (value || '').replace(/\s+/g, ' ').trim();
			if (!text) return null;
			return text.slice(0, 100);
		};

		// Direct text content of the <a> (excluding any nested <img>/<svg>/<style>/<script>).
		const ownText = (() => {
			let acc = '';
			const walk = (node) => {
				if (!node) return;
				if (node.nodeType === Node.TEXT_NODE) {
					acc += node.textContent + ' ';
					return;
				}
				if (node.nodeType !== Node.ELEMENT_NODE) return;
				const tag = node.tagName.toUpperCase();
				if (tag === 'IMG' || tag === 'SVG' || tag === 'PICTURE' || tag === 'STYLE' || tag === 'SCRIPT') return;
				Array.from(node.childNodes).forEach(walk);
			};
			Array.from(el.childNodes).forEach(walk);
			return clean(acc);
		})();

		if (ownText) {
			return { label: ownText, kind: 'text' };
		}

		const imageEl = el.querySelector('img');
		if (imageEl) {
			const altLabel = clean(imageEl.getAttribute('alt') || '');
			if (altLabel) {
				return { label: altLabel, kind: 'image' };
			}
			return { label: null, kind: 'image' };
		}

		return { label: null, kind: 'unknown' };
	}

	/**
	 * Adaugă user_id în toate link-urile către checkout
	 * Suportă și link-uri standard (<a href="">) și butoane Leadpages (.lp-button-react[data-widget-link])
	 */
	async function enhanceCheckoutLinks() {
		// Previne execuții concurente — a doua invocare returnează imediat
		if (window._acEnhancingCheckout) return;
		window._acEnhancingCheckout = true;
		try {
		return await _enhanceCheckoutLinksInner();
		} finally {
			window._acEnhancingCheckout = false;
		}
	}

	async function _enhanceCheckoutLinksInner() {
		const currentUserId = await getUserId();

		// Găsește toate link-urile și butoanele Leadpages
		const elements = document.querySelectorAll('a[href], .lp-button-react[data-widget-link]');

		elements.forEach(element => {
			// ── Evită re-procesarea elementelor deja enhanced ──────────
			// NOTĂ: dataset.acEnhanced e insuficient singur — Leadpages distruge
			// și recreează nodurile DOM (SPA re-render), deci noul nod nu are atributul.
			// Protecția reală împotriva duplicate events e _checkoutEventSentAt de mai jos.
			if (element.dataset.acEnhanced === '1') return;

			// Extrage URL-ul din href sau data-widget-link
			const href = element.getAttribute('href') || element.getAttribute('data-widget-link');
			if (!href) return;

			// Determină tipul elementului pentru update ulterior
			const isLeadpagesButton = element.classList.contains('lp-button-react');
			// <a> tags navigate via href (browser standard).
			// Div/span LP buttons fără href folosesc data-widget-link ca target URL.
			// NOTĂ: noile versiuni Leadpages randează <a href> cu data-widget-link="true"
			// ca simplu flag boolean — în acest caz urlAttribute trebuie să fie 'href'.
			const urlAttribute = element.tagName.toLowerCase() === 'a' ? 'href' : 'data-widget-link';

			// Count only genuine checkout links to avoid attaching listeners on generic links.
			const isCheckoutLink = _isCheckoutHref(href);

			if (isCheckoutLink) {
				const buttonIndicator = _getCheckoutContainerIndicator(element);
				// Only track buttons inside one of the three approved containers:
				//   - parent #buy-button-N
				//   - parent #hero-section
				//   - element with class .aw-sticky-cta-btn
				// Anything else is noise and must be ignored.
				if (!buttonIndicator.container_type) return;
				try {
					const url = new URL(href, window.location.origin);

					// Extrage product_id din URL (ex: /product/640053/ → 640053)
					const productIdMatch = url.pathname.match(/(\d{6,})/);
					const productId = productIdMatch ? productIdMatch[1] : null;

					// Adaugă user_id în 'custom' parameter (Digistore24 format)
					// Format: user_id---existing_custom_data
					// Dacă ?custom= există deja și începe cu user_id-ul curent, nu îl mai prefixăm
					// (evită dublarea la MutationObserver sau re-run)
					const existingCustom = url.searchParams.get('custom') || '';
					let customValue;
					if (existingCustom.startsWith(currentUserId)) {
						// Deja setat corect — nu modifica
						customValue = existingCustom;
					} else if (existingCustom) {
						// Există alt custom (ex: hardcodat în pagină) — prefixează cu user_id
						customValue = `${currentUserId}---${existingCustom}`;
					} else {
						customValue = currentUserId;
					}
					url.searchParams.set('custom', customValue);

					// Update link/button cu URL-ul modificat
					element.setAttribute(urlAttribute, url.toString());
					// Dacă <a> are și data-widget-link (LP boolean flag), actualizăm și pe el
					// — unele versiuni Leadpages citesc data-widget-link pentru propriul router JS
					if (urlAttribute === 'href' && element.hasAttribute('data-widget-link')) {
						element.setAttribute('data-widget-link', url.toString());
					}
					// ── Marchează elementul ca enhanced (evită re-procesare) ──
					element.dataset.acEnhanced = '1';

					// Track click event înainte ca user-ul să plece
					element.addEventListener('click', async function() {
						try {
							if (productId) {
								localStorage.setItem(
									'ac_checkout_' + productId,
									JSON.stringify({
										user_id: currentUserId,
										slug: getTrafficSource().slug,
										ts: Date.now()
									})
								);
								debugLog('✅ Checkout lookup saved for product_id:', productId);
							}

							const liveButtonMeta = _extractCheckoutButtonLabelAndKind(element);
							const clickedButtonText = liveButtonMeta.label;

						// Determine position from structured HTML IDs (#buy-button-N, #hero-section).
						// Sticky CTA is detected via class and reported with position=null.
						const isStickyClick = (
							element.classList.contains('aw-sticky-cta-btn') ||
							!!element.closest('.aw-sticky-cta-btn')
						);
						const _posInfo = isStickyClick ? { position: null } : _getButtonPositionFromElement(element);
						const clickedIndex = _posInfo.position;
						const clickedTotal = isStickyClick ? null : _computeCheckoutButtonList().length || null;
						const clickedDomFingerprint = _domFingerprint(element);

							await trackEvent('checkout_initiated', {
								product_id: productId,
								checkout_url: url.toString(),
								button_label: clickedButtonText,
								button_content_kind: liveButtonMeta.kind,
								button_dom_fingerprint: clickedDomFingerprint,
								button_container_id: buttonIndicator.container_id,
								button_container_type: buttonIndicator.container_type,
								button_position: clickedIndex || null,
								button_total: clickedTotal || null,
								is_sticky_cta: isStickyClick || undefined,
								timestamp: Date.now(),
								element_type: isLeadpagesButton ? 'leadpages_button' : 'link'
							});
							debugLog('✅ Checkout initiated tracked');
						} catch (err) {
							debugLog('⚠️ Failed to track checkout initiated:', err);
						}
					});

					debugLog(`Enhanced ${isLeadpagesButton ? 'Leadpages button' : 'checkout link'}:`, url.toString());
				} catch (e) {
					// URL relativ sau invalid, skip
					debugLog('Failed to enhance checkout element:', e);
				}
			}
		});
	}

	/**
	 * Observer pentru link-uri adăugate dinamic
	 * Debounced: apelează enhanceCheckoutLinks() o singură dată după ce mutațiile DOM se stabilizează.
	 * Fără debounce, Leadpages SPA poate genera zeci de mutații în rafală → zeci de listeneri duplicați.
	 */
	function observeNewLinks() {
		let _debounceTimer = null;
		const observer = new MutationObserver((mutations) => {
			const hasAddedNodes = mutations.some(m => m.addedNodes.length > 0);
			if (!hasAddedNodes) return;
			clearTimeout(_debounceTimer);
			_debounceTimer = setTimeout(() => {
			enhanceCheckoutLinks().then(() => {
				window._acPageCheckoutButtons = _computeCheckoutButtonList();
				_trackCheckoutButtonsInventory().catch(err => debugLog('Failed to track checkout buttons inventory:', err));
			});
		}, 200);
		});

		observer.observe(document.body, {
			childList: true,
			subtree: true
		});
	}

	// ═══════════════════════════════════════════════════════════════
	// UTILITIES
	// ═══════════════════════════════════════════════════════════════

	function debugLog(...args) {
		if (CONFIG.DEBUG_MODE) {
			console.log('[AppCore]', ...args);
		}
	}

	// ═══════════════════════════════════════════════════════════════
	// INITIALIZATION
	// ═══════════════════════════════════════════════════════════════

	async function init() {
		debugLog('Initializing User Journey Tracker...');

		// 0. Verifică allowlist — oprește tracking pe domenii neașteptate (WebView-uri, editoare)
		if (CONFIG.ALLOWED_DOMAINS.length > 0) {
			const currentDomain = window.location.hostname;
			if (!CONFIG.ALLOWED_DOMAINS.includes(currentDomain)) {
				debugLog('Domain not in allowlist, tracking disabled:', currentDomain);
				return;
			}
		}

		// 1. Generează/obține user ID
		await getUserId();

		// 2. Track pageview
		await trackPageview();

		// 3. Retry failed events
		await retryFailedEvents();

		// 3.1 Track lightweight page scroll behavior summary (for heatmap-style analytics)
		initScrollBehaviorTracking();

		// 4. Enhance checkout links
		await enhanceCheckoutLinks();

		// 5. Pre-compute checkout button list for position tracking.
		// Uses window.load so all styles are applied and Leadpages buttons are rendered.
		if (document.readyState === 'complete') {
			window._acPageCheckoutButtons = _computeCheckoutButtonList();
			debugLog('Checkout buttons pre-computed:', window._acPageCheckoutButtons.length);
			await _trackCheckoutButtonsInventory();
		} else {
			window.addEventListener('load', () => {
				window._acPageCheckoutButtons = _computeCheckoutButtonList();
				debugLog('Checkout buttons pre-computed on load:', window._acPageCheckoutButtons.length);
				_trackCheckoutButtonsInventory().catch(err => debugLog('Failed to track checkout buttons inventory:', err));
			}, { once: true });
		}

		// 6. Observe pentru link-uri noi
		observeNewLinks();

		debugLog('User Journey Tracker initialized successfully');
	}

	// ═══════════════════════════════════════════════════════════════
	// PUBLIC API
	// ═══════════════════════════════════════════════════════════════

	// Expune funcții globale pentru usage manual
	window.AppCore = {
		trackConversion: trackConversion,
		trackEvent: trackEvent,
		getUserId: getUserId,
		getTrafficSource: getTrafficSource,
		config: CONFIG
	};

	// ═══════════════════════════════════════════════════════════════
	// AUTO-START
	// ═══════════════════════════════════════════════════════════════

	// Start when DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

})();
