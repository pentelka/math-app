// Public count of completed rounds, shared by everyone who uses the site.
//
// The site is static, so the number lives in a free anonymous counter service (Abacus,
// https://abacus.jasoncameron.dev). It is not reset by new releases. Nothing personal is
// sent: a request only says "one more round was completed".
//
// The service can be slow or briefly down, so this module is built to cope:
//   - The last total seen is remembered on the device and shown at once (cached()).
//   - A completed round is first saved on the device as "pending" and then sent. If
//     sending fails, it stays pending and is sent on a later visit (refresh()). Devices
//     that were offline at different times all add their rounds eventually, because the
//     service only ever adds one per request.
//   - Only one send runs at a time, so a pending round is never sent twice by this page.
//
// Only the live site increments the counter (see COUNTING_HOSTS), so local runs and tests
// don't inflate it. Every failure resolves quietly; the app hides the number only when no
// total has ever been seen on this device.
(function (root) {
  'use strict';

  const BASE = 'https://abacus.jasoncameron.dev';
  const NAMESPACE = 'pentelka-math-app';
  const KEY = 'rounds-completed';
  const COUNTING_HOSTS = ['pentelka.github.io'];
  const STORAGE_KEY = 'algebra-quiz-counter-v1';
  const GET_TIMEOUT_MS = 15000;
  const HIT_TIMEOUT_MS = 25000;
  const MAX_PENDING = 50; // cap what one device can queue
  const MAX_SEND_PER_FLUSH = 10; // and how many it sends in one go

  // env: { fetch, hostname, search, storage } so this can be tested without a browser.
  function make(env) {
    const disabled = /[?&]counter=off\b/.test(env.search || '');
    const counts = COUNTING_HOSTS.includes(env.hostname);
    let flushing = null; // the send in progress, shared by concurrent callers
    // In-memory copy, used when localStorage is missing or refuses to save (some private
    // browsing modes), so a round can still be sent during this visit.
    let memory = { last: null, pending: 0 };
    let storageOk = !!env.storage;

    function parse(raw) {
      const d = JSON.parse(raw || '{}');
      return {
        last: typeof d.last === 'number' && d.last >= 0 ? d.last : null,
        pending: Number.isInteger(d.pending) && d.pending > 0 ? Math.min(d.pending, MAX_PENDING) : 0,
      };
    }

    function load() {
      if (storageOk) {
        try {
          return parse(env.storage.getItem(STORAGE_KEY));
        } catch (e) {
          storageOk = false;
        }
      }
      return { last: memory.last, pending: memory.pending };
    }

    function save(s) {
      memory = { last: s.last, pending: s.pending };
      if (!storageOk) return;
      try {
        env.storage.setItem(STORAGE_KEY, JSON.stringify(memory));
      } catch (e) {
        storageOk = false;
      }
    }

    async function request(action, timeoutMs) {
      if (typeof env.fetch !== 'function') return null;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
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

    // Best known total: the last total from the service plus this device's unsent rounds.
    function cached() {
      if (disabled) return null;
      const s = load();
      return s.last === null ? null : s.last + s.pending;
    }

    // Sends this device's pending rounds, one request each, stopping at the first failure.
    function flush() {
      if (disabled || !counts) return Promise.resolve();
      if (flushing) return flushing;
      flushing = (async () => {
        try {
          for (let sent = 0; sent < MAX_SEND_PER_FLUSH && load().pending > 0; sent++) {
            const total = await request('hit', HIT_TIMEOUT_MS);
            if (typeof total !== 'number') break;
            const s = load();
            s.pending = Math.max(0, s.pending - 1);
            s.last = total;
            save(s);
          }
        } finally {
          flushing = null;
        }
      })();
      return flushing;
    }

    // Sends anything pending, then reads the current total. Resolves to cached().
    async function refresh() {
      if (disabled) return null;
      await flush();
      const total = await request('get', GET_TIMEOUT_MS);
      if (typeof total === 'number') {
        const s = load();
        s.last = total;
        save(s);
      }
      return cached();
    }

    // Records one completed round. Resolves to { total, sent }: the best known total, and
    // whether this round already reached the service (false means it waits on the device).
    async function hit() {
      if (disabled) return { total: null, sent: false };
      if (!counts) return { total: await refresh(), sent: false };
      const before = load();
      before.pending = Math.min(before.pending + 1, MAX_PENDING);
      save(before);
      await flush();
      const after = load();
      return { total: cached(), sent: after.pending < before.pending };
    }

    return { cached, refresh, hit, counts };
  }

  const api = { make, BASE, NAMESPACE, KEY, COUNTING_HOSTS, STORAGE_KEY, MAX_PENDING };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    const loc = root.location || {};
    let storage = null;
    try {
      storage = root.localStorage;
    } catch (e) {
      storage = null;
    }
    root.Counter = make({
      fetch: root.fetch ? root.fetch.bind(root) : null,
      hostname: loc.hostname || '',
      search: loc.search || '',
      storage,
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
