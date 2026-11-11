const test = require('node:test');
const assert = require('node:assert/strict');
const Counter = require('../src/counter.js');

const LIVE = 'pentelka.github.io';

function memoryStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    data,
  };
}

const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

// A fake counter service holding a real total. `up` can be switched off to simulate an outage.
function fakeService(start) {
  const svc = { total: start, up: true, calls: [] };
  svc.fetch = async (url) => {
    svc.calls.push(url.replace(Counter.BASE, ''));
    if (!svc.up) throw new Error('timeout');
    if (url.includes('/hit/')) svc.total++;
    return svc.total === 0 && url.includes('/get/') ? json(404, { error: 'Key not found' }) : json(200, { value: svc.total });
  };
  return svc;
}

const state = (storage) => JSON.parse(storage.getItem(Counter.STORAGE_KEY) || '{}');

test('on the live site, a round is sent at once and the new total is returned', async () => {
  const svc = fakeService(41);
  const storage = memoryStorage();
  const c = Counter.make({ fetch: svc.fetch, hostname: LIVE, search: '', storage });
  assert.deepEqual(await c.hit(), { total: 42, sent: true });
  assert.equal(svc.total, 42);
  assert.deepEqual(state(storage), { last: 42, pending: 0 });
  assert.match(svc.calls[0], /^\/hit\/pentelka-math-app\/rounds-completed$/);
});

test('when the service is down, the round waits on the device and the shown total still grows', async () => {
  const svc = fakeService(10);
  const storage = memoryStorage({ [Counter.STORAGE_KEY]: JSON.stringify({ last: 10, pending: 0 }) });
  const c = Counter.make({ fetch: svc.fetch, hostname: LIVE, search: '', storage });
  svc.up = false;
  assert.deepEqual(await c.hit(), { total: 11, sent: false });
  assert.equal(svc.total, 10, 'nothing reached the service');
  assert.deepEqual(state(storage), { last: 10, pending: 1 });
  assert.equal(c.cached(), 11);
});

test('pending rounds are sent on a later visit, from several devices that were offline at different times', async () => {
  const svc = fakeService(100);
  svc.up = false;
  const phone = memoryStorage();
  const laptop = memoryStorage();
  const onPhone = () => Counter.make({ fetch: svc.fetch, hostname: LIVE, search: '', storage: phone });
  const onLaptop = () => Counter.make({ fetch: svc.fetch, hostname: LIVE, search: '', storage: laptop });

  await onPhone().hit();
  await onPhone().hit();
  await onLaptop().hit();
  assert.equal(svc.total, 100);

  svc.up = true;
  assert.equal(await onLaptop().refresh(), 101, 'laptop comes back first');
  assert.equal(await onPhone().refresh(), 103, 'phone comes back later and adds its two');
  assert.equal(svc.total, 103);
  assert.equal(state(phone).pending, 0);
  assert.equal(state(laptop).pending, 0);
});

test('concurrent refreshes never send the same pending round twice', async () => {
  const svc = fakeService(5);
  const storage = memoryStorage({ [Counter.STORAGE_KEY]: JSON.stringify({ last: 5, pending: 2 }) });
  const c = Counter.make({ fetch: svc.fetch, hostname: LIVE, search: '', storage });
  await Promise.all([c.refresh(), c.refresh(), c.refresh()]);
  assert.equal(svc.total, 7);
  assert.equal(state(storage).pending, 0);
});

test('cached() shows the last known total immediately, before any request', () => {
  const storage = memoryStorage({ [Counter.STORAGE_KEY]: JSON.stringify({ last: 6, pending: 1 }) });
  const c = Counter.make({ fetch: async () => { throw new Error('should not be called'); }, hostname: LIVE, storage });
  assert.equal(c.cached(), 7);
  assert.equal(Counter.make({ fetch: null, hostname: LIVE, storage: memoryStorage() }).cached(), null);
});

test('elsewhere (local file, localhost), hit only reads and never queues', async () => {
  for (const hostname of ['', 'localhost', '127.0.0.1']) {
    const svc = fakeService(7);
    const storage = memoryStorage();
    const c = Counter.make({ fetch: svc.fetch, hostname, search: '', storage });
    assert.deepEqual(await c.hit(), { total: 7, sent: false });
    assert.ok(svc.calls.every((u) => u.startsWith('/get/')), hostname);
    assert.equal(state(storage).pending || 0, 0);
  }
});

test('a counter that does not exist yet reads as 0', async () => {
  const svc = fakeService(0);
  const c = Counter.make({ fetch: svc.fetch, hostname: '', storage: memoryStorage() });
  assert.equal(await c.refresh(), 0);
});

test('?counter=off disables everything', async () => {
  const svc = fakeService(1);
  const storage = memoryStorage({ [Counter.STORAGE_KEY]: JSON.stringify({ last: 9, pending: 0 }) });
  const c = Counter.make({ fetch: svc.fetch, hostname: LIVE, search: '?counter=off', storage });
  assert.deepEqual(await c.hit(), { total: null, sent: false });
  assert.equal(await c.refresh(), null);
  assert.equal(c.cached(), null);
  assert.equal(svc.calls.length, 0);
});

test('bad responses, missing fetch and broken storage never throw', async () => {
  const garbage = Counter.make({ fetch: async () => json(200, { nope: 1 }), hostname: LIVE, storage: memoryStorage() });
  assert.deepEqual(await garbage.hit(), { total: null, sent: false });
  const noFetch = Counter.make({ fetch: null, hostname: LIVE, storage: memoryStorage() });
  assert.deepEqual(await noFetch.hit(), { total: null, sent: false });
  const broken = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
  };
  const svc = fakeService(3);
  const noStorage = Counter.make({ fetch: svc.fetch, hostname: LIVE, storage: broken });
  await noStorage.hit();
  assert.equal(svc.total, 4, 'still counts the round when it can be sent right away');
  const corrupted = memoryStorage({ [Counter.STORAGE_KEY]: '{not json' });
  assert.equal(Counter.make({ fetch: null, hostname: LIVE, storage: corrupted }).cached(), null);
});

test('the queue on one device is capped', async () => {
  const svc = fakeService(0);
  svc.up = false;
  const storage = memoryStorage({ [Counter.STORAGE_KEY]: JSON.stringify({ last: 0, pending: 9999 }) });
  const c = Counter.make({ fetch: svc.fetch, hostname: LIVE, storage });
  await c.hit();
  assert.equal(state(storage).pending, Counter.MAX_PENDING);
});

// ----- User counter: each device is counted once -----

function usersService(start) {
  // Same fake, but only answers for the users key.
  const svc = fakeService(start);
  const inner = svc.fetch;
  svc.fetch = async (url) => {
    assert.match(url, /\/pentelka-math-app\/users$/);
    return inner(url);
  };
  return svc;
}

const usersState = (storage) => JSON.parse(storage.getItem(Counter.STORAGE_KEYS.users) || '{}');

test('a device is counted once as a user, however many visits it makes', async () => {
  const svc = usersService(20);
  const storage = memoryStorage();
  for (let visit = 0; visit < 3; visit++) {
    const c = Counter.make({ fetch: svc.fetch, hostname: LIVE, search: '', storage });
    assert.equal(await c.users.register(), 21);
  }
  assert.equal(svc.total, 21);
  assert.equal(svc.calls.filter((u) => u.startsWith('/hit/')).length, 1);
  assert.deepEqual(usersState(storage), { last: 21, pending: 0, registered: true });
});

test('two devices are two users', async () => {
  const svc = usersService(0);
  await Counter.make({ fetch: svc.fetch, hostname: LIVE, storage: memoryStorage() }).users.register();
  await Counter.make({ fetch: svc.fetch, hostname: LIVE, storage: memoryStorage() }).users.register();
  assert.equal(svc.total, 2);
});

test('a first visit during an outage is counted on a later visit, still only once', async () => {
  const svc = usersService(5);
  svc.up = false;
  const storage = memoryStorage();
  const visit = () => Counter.make({ fetch: svc.fetch, hostname: LIVE, storage }).users.register();
  await visit();
  assert.equal(svc.total, 5);
  assert.deepEqual(usersState(storage), { last: null, pending: 1, registered: true });
  svc.up = true;
  assert.equal(await visit(), 6);
  assert.equal(await visit(), 6);
  assert.equal(svc.total, 6);
});

test('users are only counted on the live site, and not when storage is blocked', async () => {
  const offSite = usersService(3);
  await Counter.make({ fetch: offSite.fetch, hostname: 'localhost', storage: memoryStorage() }).users.register();
  assert.equal(offSite.total, 3);
  assert.ok(offSite.calls.every((u) => u.startsWith('/get/')));

  const blocked = usersService(3);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  await Counter.make({ fetch: blocked.fetch, hostname: LIVE, storage: broken }).users.register();
  assert.equal(blocked.total, 3, 'a device that cannot remember being counted is not counted');
});

test('the user and round counters keep separate state on the device', async () => {
  const rounds = fakeService(10);
  const users = fakeService(4);
  const route = async (url) => (url.includes('/users') ? users.fetch(url) : rounds.fetch(url));
  const storage = memoryStorage();
  const c = Counter.make({ fetch: route, hostname: LIVE, storage });
  await c.users.register();
  await c.hit();
  assert.equal(users.total, 5);
  assert.equal(rounds.total, 11);
  assert.equal(c.users.cached(), 5);
  assert.equal(c.cached(), 11);
});
