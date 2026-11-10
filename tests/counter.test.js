const test = require('node:test');
const assert = require('node:assert/strict');
const Counter = require('../src/counter.js');

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return handler(url);
  };
  fn.calls = calls;
  return fn;
}

const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('on the live site, hit increments and returns the new total', async () => {
  const fetch = fakeFetch(() => json(200, { value: 42 }));
  const c = Counter.make({ fetch, hostname: 'pentelka.github.io', search: '' });
  assert.equal(await c.hit(), 42);
  assert.match(fetch.calls[0], /\/hit\/pentelka-math-app\/rounds-completed$/);
});

test('elsewhere (local file, localhost, tests), hit only reads', async () => {
  for (const hostname of ['', 'localhost', '127.0.0.1']) {
    const fetch = fakeFetch(() => json(200, { value: 7 }));
    const c = Counter.make({ fetch, hostname, search: '' });
    assert.equal(await c.hit(), 7);
    assert.match(fetch.calls[0], /\/get\//, hostname);
  }
});

test('a counter that does not exist yet reads as 0', async () => {
  const c = Counter.make({ fetch: fakeFetch(() => json(404, { error: 'Key not found' })), hostname: '' });
  assert.equal(await c.get(), 0);
});

test('failures resolve to null and never throw', async () => {
  const down = Counter.make({ fetch: fakeFetch(() => json(500, {})), hostname: 'pentelka.github.io' });
  assert.equal(await down.hit(), null);
  const offline = Counter.make({ fetch: async () => { throw new Error('offline'); }, hostname: 'pentelka.github.io' });
  assert.equal(await offline.hit(), null);
  const garbage = Counter.make({ fetch: fakeFetch(() => json(200, { nope: 1 })), hostname: '' });
  assert.equal(await garbage.get(), null);
  const noFetch = Counter.make({ fetch: null, hostname: 'pentelka.github.io' });
  assert.equal(await noFetch.hit(), null);
});

test('?counter=off disables all requests', async () => {
  const fetch = fakeFetch(() => json(200, { value: 1 }));
  const c = Counter.make({ fetch, hostname: 'pentelka.github.io', search: '?counter=off' });
  assert.equal(await c.hit(), null);
  assert.equal(await c.get(), null);
  assert.equal(fetch.calls.length, 0);
});
