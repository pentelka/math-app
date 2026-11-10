#!/usr/bin/env node
// Sets the app version everywhere it appears, so browsers fetch fresh files after a release:
//   - package.json "version"
//   - <meta name="app-version"> in index.html (read by the "new version" check in app.js)
//   - the ?v= cache-busting suffix on every local script and stylesheet in index.html
//
// Usage: npm run bump -- 1.2.0     (or with no argument to bump the patch number)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const htmlPath = path.join(root, 'index.html');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
let next = process.argv[2];
if (!next) {
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  next = [major, minor, patch + 1].join('.');
}
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('Version must look like 1.2.3, got: ' + next);
  process.exit(1);
}

pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(/(<meta name="app-version" content=")[^"]*(")/, '$1' + next + '$2');
// Local (relative) src/href attributes, with or without an existing ?v=
html = html.replace(/((?:src|href)=")(?!https?:|\/\/|#)([^"?]+\.(?:js|css))(?:\?v=[^"]*)?(")/g, '$1$2?v=' + next + '$3');
fs.writeFileSync(htmlPath, html);

console.log('Version set to ' + next);
