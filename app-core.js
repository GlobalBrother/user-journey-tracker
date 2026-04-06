/**
 * AppCore Analytics v1.0
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
		CHECKOUT_DOMAINS: ['digistore24.com', 'thrivecart.com'],

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

			// Browser
			userAgent: navigator.userAgent,
			language: navigator.language,
			platform: navigator.platform,
			hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
			deviceMemory: navigator.deviceMemory || 'unknown',

			// Timezone
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			timezoneOffset: new Date().getTimezoneOffset(),

			// Canvas fingerprint (mai precis)
			canvas: getCanvasFingerprint(),

			// WebGL fingerprint
			webgl: getWebGLFingerprint(),

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
	let pageviewSent = false;

	/**
	 * Obține sau creează user ID
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
			debugLog('User ID from localStorage:', userId);
			return userId;
		}

		// 2. Prima vizită pe acest domeniu — generează fingerprint.
		// Fingerprint-ul este util cross-domain pe Chrome/Firefox (unde e stabil):
		// dacă userul a vizitat domeniul A înainte, domeniul B va genera același
		// fingerprint → același user_id fără să fi vizitat B înainte.
		// Pe iOS Safari fingerprint-ul diferă per domeniu (canvas noise per eTLD+1),
		// deci nu ajută cross-domain, dar nici nu strică — tot generează un ID unic.
		fingerprint = await generateFingerprint();
		userId = fingerprint;

		localStorage.setItem(STORAGE_KEY, userId);
		if (!localStorage.getItem(STORAGE_KEY_FIRST_SEEN)) {
			localStorage.setItem(STORAGE_KEY_FIRST_SEEN, new Date().toISOString());
		}

		debugLog('User ID generated:', userId);
		return userId;
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
			slug: utmContent ||
			      urlParams.get('source') ||
			      urlParams.get('slug') ||
			      urlParams.get('ad') ||
			      'direct',

			// UTM parameters (salvează toate pentru tracking detaliat)
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
	 * Salvează parametri în localStorage pentru persistență pe domeniu
	 */
	function saveTrafficSource(params) {
		const TRAFFIC_SOURCE_KEY = 'ac_source';

		// Nu suprascrie dacă există deja (first-touch attribution)
		if (!localStorage.getItem(TRAFFIC_SOURCE_KEY)) {
			localStorage.setItem(TRAFFIC_SOURCE_KEY, JSON.stringify(params));
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
			document.body.appendChild(img);

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
	 * Track pageview (automat) - Conform API-SPECIFICATION.md
	 */
	async function trackPageview() {
		if (pageviewSent) return;
		pageviewSent = true;

		const urlParams = extractUrlParameters();
		saveTrafficSource(urlParams);

		// Detectează device type
		const deviceType = /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop';

		// Detectează browser
		const browser = detectBrowser();

		// Detectează OS
		const os = detectOS();

		const payload = {
			user_id: await getUserId(),
			cohort_id: await calculateCohortId(urlParams, deviceType, navigator.language),
			domain: window.location.hostname,
			url: window.location.href,
			slug: urlParams.slug,  // Now contains utm_content (most specific!)
			referrer: document.referrer || null,
			timestamp: new Date().toISOString(),

			// UTM parameters (tracking complet pentru Facebook Ads)
			utm_source: urlParams.utm_source,
			utm_medium: urlParams.utm_medium,
			utm_campaign: urlParams.utm_campaign,
			utm_content: urlParams.utm_content,  // Ad creative specific
			utm_term: urlParams.utm_term,
			utm_id: urlParams.utm_id,            // Facebook Ad ID

			// Device/Browser info
			device_type: deviceType,
			browser: browser,
			os: os,
			screen_resolution: `${screen.width}x${screen.height}`,
			country: null, // Backend poate detecta din IP
			language: navigator.language,

			// Facebook specific
			fbclid: urlParams.fbclid
		};

		await sendEvent('/api/events', payload);
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

		const payload = {
			user_id: await getUserId(),
			cohort_id: await calculateCohortId(trafficSource, deviceType, navigator.language),
			order_id: conversionData.order_id || null,
			product_name: conversionData.product_name || null,
			product_id: conversionData.product_id || null,
			value: conversionData.value || 0,
			currency: conversionData.currency || 'EUR',
			domain: window.location.hostname,
			conversion_page: window.location.href,
			timestamp: new Date().toISOString(),
			attribution_slug: trafficSource.slug,
			time_to_conversion_minutes: null // Backend poate calcula
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
		const payload = {
			user_id: await getUserId(),
			event_type: 'custom_event',
			event_name: eventName,
			domain: window.location.hostname,
			url: window.location.href,
			timestamp: new Date().toISOString(),
			metadata: eventData
		};

		await sendEvent('/api/actions', payload);
	}

	// ═══════════════════════════════════════════════════════════════
	// CHECKOUT LINK ENHANCEMENT
	// ═══════════════════════════════════════════════════════════════

	/**
	 * Adaugă user_id în toate link-urile către checkout
	 * Suportă și link-uri standard (<a href="">) și butoane Leadpages (.lp-button-react[data-widget-link])
	 */
	async function enhanceCheckoutLinks() {
		const currentUserId = await getUserId();

		// Găsește toate link-urile și butoanele Leadpages
		const elements = document.querySelectorAll('a[href], .lp-button-react[data-widget-link]');

		elements.forEach(element => {
			// Extrage URL-ul din href sau data-widget-link
			const href = element.getAttribute('href') || element.getAttribute('data-widget-link');
			if (!href) return;

			// Determină tipul elementului pentru update ulterior
			const isLeadpagesButton = element.classList.contains('lp-button-react');
			const urlAttribute = isLeadpagesButton ? 'data-widget-link' : 'href';

			// Check dacă link-ul merge către un domeniu de checkout
			const isCheckoutLink = CONFIG.CHECKOUT_DOMAINS.some(domain =>
				href.includes(domain)
			);

			if (isCheckoutLink) {
				try {
					const url = new URL(href, window.location.origin);

					// Extrage product_id din URL (ex: /product/640053/ → 640053)
					const productIdMatch = url.pathname.match(/(\d{6,})/);
					const productId = productIdMatch ? productIdMatch[1] : null;

					// Adaugă user_id în 'custom' parameter (Digistore24 format)
					// Format: user_id---existing_custom_data
					const existingCustom = url.searchParams.get('custom') || '';
					const customValue = existingCustom
						? `${currentUserId}---${existingCustom}`
						: currentUserId;
					url.searchParams.set('custom', customValue);

					// Update link/button cu URL-ul modificat
					element.setAttribute(urlAttribute, url.toString());

					// CHECKOUT TRACKING REDUNDANCY:
					// Track click event înainte ca user-ul să plece
					element.addEventListener('click', async function(e) {
						// Nu prevenim default - lăsăm user-ul să meargă la checkout
						try {
							await trackEvent('checkout_initiated', {
								product_id: productId,
								checkout_url: url.toString(),
								timestamp: Date.now(),
								element_type: isLeadpagesButton ? 'leadpages_button' : 'link'
							});
							debugLog('✅ Checkout initiated tracked');
						} catch (err) {
							debugLog('⚠️ Failed to track checkout initiated:', err);
						}
					}, { once: true }); // once: true = rulează o singură dată

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
	 */
	function observeNewLinks() {
		const observer = new MutationObserver(async (mutations) => {
			for (const mutation of mutations) {
				if (mutation.addedNodes.length) {
					await enhanceCheckoutLinks();
				}
			}
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

		// 1. Generează/obține user ID
		await getUserId();

		// 2. Track pageview
		await trackPageview();

		// 3. Retry failed events
		await retryFailedEvents();

		// 4. Enhance checkout links
		await enhanceCheckoutLinks();

		// 5. Observe pentru link-uri noi
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
