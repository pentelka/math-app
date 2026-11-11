# Project instructions

אלגברה בלי טעויות is a Hebrew multiple-choice quiz on algebra rules and common
mistakes, from the basics up to 5 יח״ל Bagrut level. It runs in the browser, on phones
and computers, with no build step and no dependencies.

## Layout

- `index.html`, `styles.css`: the page (RTL Hebrew) and its look, light and dark.
- `src/bank.js`: the question bank. Most content work happens here.
- `src/quiz.js`: levels, topics, question types, round building and answer shuffling.
  Pure logic, no DOM.
- `src/progress.js`: progress over time in `localStorage` (answers per question, rounds,
  practice days) and the priority that makes wrong or unseen questions likelier. Pure
  functions take `now`; only `load`/`save`/`clear` touch storage, and they never throw.
  If the stored shape changes, bump `version` and the storage key.
- `src/counter.js`: the public counters (completed rounds, and users = devices counted
  once on their first visit), stored in the anonymous Abacus counter service. Only `pentelka.github.io` increments it; everything else only reads.
  The service can be slow, so the last total is remembered on the device and shown at
  once, and a round that can't be sent stays pending in `localStorage` and is sent on a
  later visit (one send at a time, so nothing is sent twice by the page).
- `src/app.js`: screens, input and rendering text with `$math$`.
- `vendor/katex/`: KaTeX 0.16.11 (MIT), vendored so the app works offline. Only the
  woff2 fonts are included.
- `tests/`: Node's built-in test runner (`node --test`).

## Writing questions

- The point is avoiding mistakes in algebra rules, not calculation. A question should
  be answerable in your head.
- Exactly four options. Wrong options are real, common mistakes, not random values.
- The explanation says why the right answer is right and names the mistake behind the
  most tempting wrong answer. Keep it to two or three sentences.
- Mix the four types (`value`, `step`, `error`, `condition`) across each topic.
- Math goes between `$...$` in KaTeX syntax. Write strings with the `r` tag
  (String.raw). Never write `${` inside one, because that starts template interpolation.
- Check the math by hand, including every line of an `error` question. The tests check
  structure and rendering, not mathematical truth.
- Put a question at the lowest level where its material is taught. A topic's
  `minLevel` in `quiz.js` must not be above the level of its questions.

## Rules

- Keep it working when `index.html` is opened directly from disk: plain scripts, no ES
  modules, no bundler, no CDNs. The only network call is the anonymous round counter, and
  the app must work fully without it. Add `?counter=off` to the URL to disable it.
- The interface text is Hebrew. Math is always rendered left-to-right inside
  `<span class="math" dir="ltr">`.
- No ads, tracking or accounts. Settings and progress stay in `localStorage`, wrapped in
  try/catch. The round counter sends nothing personal, only "one more round".
- **Every release that changes files the page loads:** run `npm run bump` (or
  `npm run bump -- 1.2.0`). It updates the version in `package.json`, the
  `<meta name="app-version">` and the `?v=` on every local script and stylesheet, so phones
  fetch fresh files and open tabs show the "יש גרסה חדשה" banner. `tests/version.test.js`
  fails if they disagree.
- Run `npm test` before committing.
