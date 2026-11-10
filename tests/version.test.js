const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('the page declares the package version', () => {
  const m = html.match(/<meta name="app-version" content="([^"]+)"/);
  assert.ok(m, 'missing <meta name="app-version">');
  assert.equal(m[1], version, 'run: npm run bump -- ' + version);
});

test('every local script and stylesheet carries ?v=<version>', () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)]
    .map((m) => m[1])
    .filter((u) => !/^(https?:)?\/\//.test(u));
  assert.ok(refs.length >= 7, 'expected the local scripts and stylesheets');
  for (const ref of refs) {
    assert.ok(ref.endsWith('?v=' + version), ref + ' should end with ?v=' + version + ' (npm run bump)');
    assert.ok(fs.existsSync(path.join(root, ref.split('?')[0])), ref + ' points to a missing file');
  }
});
