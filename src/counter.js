// Public counters shared by everyone who uses the site:
//   - rounds: completed rounds (all 10 questions answered)
//   - users:  devices that have opened the site (each counted once, on its first visit)
//
// The site is static, so the numbers live in a free anonymous counter service (Abacus,
// https://abacus.jasoncameron.dev). They are not reset by new releases. Nothing personal is
// sent: a request only says "one more round" or "one more device".
//
// The service can be slow or briefly down, so every counter is built to cope:
//   - The last total seen is remembered on the device and shown at once (cached()).
//   - An increment is first saved on the device as "pending" and then sent. If sending
//     fails, it stays pending and is sent on a later visit (refresh()). Devices that were
//     offline at different times all add theirs eventually, because the service only ever
//     adds one per request.
//   - Only one send per counter runs at a time, so a pending increment is never sent twice
//     by this page.
//   - Sends use fetch keepalive, so the browser finishes them even if the student closes
//     the app right after a round (the moment a round is counted). An increment leaves the
//     pending queue *before* it is sent and goes back only if the send definitely failed,
//     so a send that completes after the page is gone is never repeated on a later visit.
//
// Only the live site increments (see COUNTING_HOSTS), so local runs and tests don't inflate
// the numbers. Every failure resolves quietly.
(function (root) {
  'use strict';

  const BASE = 'https://abacus.jasoncameron.dev';
  const NAMESPACE = 'pentelka-math-app';
  const KEYS = { rounds: 'rounds-completed', users: 'users' };
  const COUNTING_HOSTS = ['pentelka.github.io'];
  const STORAGE_KEYS = { rounds: 'algebra-quiz-counter-v1', users: 'algebra-quiz-users-v1' };
  const GET_TIMEOUT_MS = 15000;
  const HIT_TIMEOUT_MS = 40000; // the service has taken up to ~25 s to answer
  const MAX_PENDING = 50; // cap what one device can queue
  const MAX_SEND_PER_FLUSH = 10; // and how many it sends in one go

  // One counter in the service, with its own state on the device:
  //   { last: total last seen | null, pending: increments not yet sent, registered: bool }
  function makeCounter(env, key, storageKey) {
    const disabled = /[?&]counter=off\b/.test(env.search || '');
    const counts = COUNTING_HOSTS.includes(env.hostname);
    let flushing = null; // the send in progress, shared by concurrent callers
    // In-memory copy, used when localStorage is missing or refuses to save (some private
    // browsing modes), so an increment can still be sent during this visit.
    let memory = { last: null, pending: 0, registered: false };
    let storageOk = !!env.storage;

    function parse(raw) {
      const d = JSON.parse(raw || '{}');
      return {
        last: typeof d.last === 'number' && d.last >= 0 ? d.last : null,
        pending: Number.isInteger(d.pending) && d.pending > 0 ? Math.min(d.pending, MAX_PENDING) : 0,
        registered: d.registered === true,
      };
    }

    function load() {
      if (storageOk) {
        try {
          return parse(env.storage.getItem(storageKey));
        } catch (e) {
          storageOk = false;
        }
      }
      return Object.assign({}, memory);
    }

    function save(s) {
      memory = Object.assign({}, s);
      if (!storageOk) return;
      try {
        // Keep the stored shape small: only write `registered` when it is set.
        const out = { last: s.last, pending: s.pending };
        if (s.registered) out.registered = true;
        env.storage.setItem(storageKey, JSON.stringify(out));
      } catch (e) {
        storageOk = false;
      }
    }

    async function request(action, timeoutMs) {
      if (typeof env.fetch !== 'function') return null;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const res = await env.fetch(BASE + '/' + action + '/' + NAMESPACE + '/' + key, {
          cache: 'no-store',
          // Let the browser finish an increment even if the page is closed meanwhile.
          keepalive: action === 'hit',
          signal: controller ? controller.signal : undefined,
        });
        if (res.status === 404) return 0; // nothing counted yet
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data.value === 'number' ? data.value : null;
      } catch (e) {
        return null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    let inflight = 0; // increments sent from this page and not answered yet

    // Best known total: the last total from the service plus this device's increments that
    // the service hasn't confirmed yet (queued or on their way).
    function cached() {
      if (disabled) return null;
      const s = load();
      return s.last === null ? null : s.last + s.pending + inflight;
    }

    // Sends this device's pending increments, one request each, stopping at the first failure.
    // Each increment is taken off the queue before its request and put back only on a
    // definite failure while this page is still open.
    function flush() {
      if (disabled || !counts) return Promise.resolve();
      if (flushing) return flushing;
      // Note: `flushing` is cleared in .finally(), which always runs after this assignment.
      // Clearing it inside the async function would run *before* the assignment when there
      // is nothing to send, leaving `flushing` set forever and blocking every later send.
      flushing = (async () => {
        for (let sent = 0; sent < MAX_SEND_PER_FLUSH; sent++) {
          let s = load();
          if (s.pending <= 0) break;
          s.pending -= 1;
          save(s);
          inflight++;
          let total;
          try {
            total = await request('hit', HIT_TIMEOUT_MS);
          } finally {
            inflight--;
          }
          s = load();
          if (typeof total !== 'number') {
            s.pending = Math.min(s.pending + 1, MAX_PENDING);
            save(s);
            break;
          }
          s.last = total;
          save(s);
        }
      })().finally(() => {
        flushing = null;
      });
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

    // Adds one. Resolves to { total, sent }: the best known total, and whether this
    // increment already reached the service (false means it waits on the device).
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

    // Adds one the first time this device calls it, never again (as long as the device keeps
    // its browser data). Without working storage it does nothing, since a device that can't
    // remember being counted would be counted on every visit.
    async function hitOnce() {
      if (disabled || !counts || !storageOk) return refresh();
      const s = load();
      if (!storageOk || s.registered) return refresh();
      s.registered = true;
      s.pending = Math.min(s.pending + 1, MAX_PENDING);
      save(s);
      return refresh();
    }

    return { cached, refresh, hit, hitOnce, flush, counts };
  }

  // env: { fetch, hostname, search, storage } so this can be tested without a browser.
  // The round counter's methods sit at the top level; the user counter is `users`.
  function make(env) {
    const rounds = makeCounter(env, KEYS.rounds, STORAGE_KEYS.rounds);
    const users = makeCounter(env, KEYS.users, STORAGE_KEYS.users);
    return {
      cached: rounds.cached,
      refresh: rounds.refresh,
      hit: rounds.hit,
      counts: rounds.counts,
      users: { cached: users.cached, refresh: users.refresh, register: users.hitOnce },
      // Sends whatever is queued for both counters (used when the page is being left).
      flush: () => Promise.all([rounds.flush(), users.flush()]),
    };
  }

  const api = { make, BASE, NAMESPACE, KEYS, COUNTING_HOSTS, STORAGE_KEYS, STORAGE_KEY: STORAGE_KEYS.rounds, MAX_PENDING };

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
