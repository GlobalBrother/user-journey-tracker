/**
 * GA4 Custom Tracking — Template per domeniu
 *
 * INSTRUCȚIUNI:
 * 1. Completează secțiunea CONFIG de mai jos
 * 2. Include-l în pagina ta DUPĂ scriptul gtag.js
 */

(function () {
  'use strict';

  var CONFIG = {

    GA4_ID: 'G-XXXXXXXXXX',

    // Scroll depth — la ce procente să trimitem eveniment (25 = 25% din pagină)
    SCROLL_THRESHOLDS: [25, 50, 75, 90],

    // Click tracking — selectori CSS pentru butoane/linkuri importante și numele evenimentelor
    CLICK_ELEMENTS: [
      // { selector: '.cta-button', event_name: 'cta_click', label: 'CTA Principal' },
      // { selector: '#add-to-cart', event_name: 'add_to_cart_click', label: 'Adauga in cos' },
      // { selector: 'a[href*="checkout"]', event_name: 'checkout_click', label: 'Mergi la checkout' },
    ],

    // Video tracking — selectori CSS pentru elementele <video> din pagina
    VIDEO_SELECTORS: [
      // '#video-demo',
    ],

    // Progresul video la care trimitem eveniment (%)
    VIDEO_MILESTONES: [25, 50, 75, 90],

    // Time on page — trimite eveniment după N secunde de stat pe pagină
    // Setează [] pentru a dezactiva
    TIME_ON_PAGE_SECONDS: [30, 60, 120],
  };
  // ─────────────────────────────────────────────
  // FIN CONFIG
  // ─────────────────────────────────────────────


  // Verifică că gtag e disponibil
  function sendEvent(eventName, params) {
    if (typeof gtag !== 'function') return;
    gtag('event', eventName, Object.assign({ send_to: CONFIG.GA4_ID }, params));
  }


  // ── Scroll Depth ─────────────────────────────
  function initScrollTracking() {
    if (!CONFIG.SCROLL_THRESHOLDS.length) return;

    var fired = {};
    var thresholds = CONFIG.SCROLL_THRESHOLDS.slice().sort(function (a, b) { return a - b; });

    function onScroll() {
      var scrolled = window.scrollY || document.documentElement.scrollTop;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;

      var pct = Math.round((scrolled / docHeight) * 100);

      for (var i = 0; i < thresholds.length; i++) {
        var t = thresholds[i];
        if (pct >= t && !fired[t]) {
          fired[t] = true;
          sendEvent('scroll_depth', {
            percent_scrolled: t,
            page_location: window.location.href,
          });
        }
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
  }


  // ── Click Tracking ────────────────────────────
  function getElementPagePercent(el) {
    var rect = el.getBoundingClientRect();
    var elTopAbsolute = rect.top + (window.scrollY || document.documentElement.scrollTop);
    var docHeight = document.documentElement.scrollHeight;
    if (docHeight <= 0) return null;
    return Math.round((elTopAbsolute / docHeight) * 100);
  }

  function initClickTracking() {
    if (!CONFIG.CLICK_ELEMENTS.length) return;

    CONFIG.CLICK_ELEMENTS.forEach(function (item) {
      var els = document.querySelectorAll(item.selector);
      els.forEach(function (el) {
        el.addEventListener('click', function () {
          var pct = getElementPagePercent(el);
          sendEvent(item.event_name, {
            element_label: item.label,
            element_position_pct: pct,  // ex: 75 = elementul e la 75% din înălțimea paginii
            page_location: window.location.href,
          });
        });
      });
    });
  }


  // ── Video Tracking ────────────────────────────
  function initVideoTracking() {
    if (!CONFIG.VIDEO_SELECTORS.length) return;

    CONFIG.VIDEO_SELECTORS.forEach(function (selector) {
      var video = document.querySelector(selector);
      if (!video) return;

      var title = video.getAttribute('data-title') || video.src || selector;
      var fired = {};

      video.addEventListener('play', function () {
        sendEvent('video_start', {
          video_title: title,
          page_location: window.location.href,
        });
      });

      video.addEventListener('timeupdate', function () {
        if (!video.duration) return;
        var pct = Math.round((video.currentTime / video.duration) * 100);

        CONFIG.VIDEO_MILESTONES.forEach(function (milestone) {
          if (pct >= milestone && !fired[milestone]) {
            fired[milestone] = true;
            sendEvent('video_progress', {
              video_title: title,
              video_percent: milestone,
              page_location: window.location.href,
            });
          }
        });
      });

      video.addEventListener('ended', function () {
        sendEvent('video_complete', {
          video_title: title,
          page_location: window.location.href,
        });
      });
    });
  }


  // ── Time on Page ──────────────────────────────
  function initTimeOnPage() {
    if (!CONFIG.TIME_ON_PAGE_SECONDS.length) return;

    var start = Date.now();
    var fired = {};

    setInterval(function () {
      var elapsed = Math.round((Date.now() - start) / 1000);
      CONFIG.TIME_ON_PAGE_SECONDS.forEach(function (t) {
        if (elapsed >= t && !fired[t]) {
          fired[t] = true;
          sendEvent('time_on_page', {
            seconds: t,
            page_location: window.location.href,
          });
        }
      });
    }, 5000);
  }


  // ── Init ──────────────────────────────────────
  function init() {
    initScrollTracking();
    initClickTracking();
    initVideoTracking();
    initTimeOnPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
