// Public count of completed rounds, shared by everyone who uses the site.
//
// The site is static, so the number lives in a free anonymous counter service (Abacus,
// https://abacus.jasoncameron.dev). It is not reset by new releases. Nothing personal is
// sent: a request only says "one more round was completed".
//
// Only the live site increments the counter (see COUNTING_HOSTS), so local runs and tests
// don't inflate it. Every failure (offline, blocked, service down) resolves to null and the
// app simply hides the number.
(function (root) {
  'use strict';

  const BASE = 'https://abacus.jasoncameron.dev';
  const NAMESPACE = 'pentelka-math-app';
  const KEY = 'rounds-completed';
  const COUNTING_HOSTS = ['pentelka.github.io'];
  const TIMEOUT_MS = 5000;

  // env: { fetch, hostname, search } so this can be tested without a browser.
  function make(env) {
    const disabled = /[?&]counter=off\b/.test(env.search || '');
    const counts = COUNTING_HOSTS.includes(env.hostname);

    async function request(action) {
      if (disabled || typeof env.fetch !== 'function') return null;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
      try {
        const res = await env.fetch(BASE + '/' + action + '/' + NAMESPACE + '/' + KEY, {
          cache: 'no-store',
          signal: controller ? controller.signal : undefined,
        });
        if (res.status === 404) return 0; // no round completed yet
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data.value === 'number' ? data.value : null;
      } catch (e) {
        return null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    return {
      // Current total, or null when unavailable.
      get: () => request('get'),
      // Adds one completed round and returns the new total. Off the live site this only
      // reads the total.
      hit: () => (counts ? request('hit') : request('get')),
      counts,
    };
  }

  const api = { make, BASE, NAMESPACE, KEY, COUNTING_HOSTS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    const loc = root.location || {};
    root.Counter = make({
      fetch: root.fetch ? root.fetch.bind(root) : null,
      hostname: loc.hostname || '',
      search: loc.search || '',
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
