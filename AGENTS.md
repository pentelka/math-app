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
  modules, no bundler, no CDNs or network calls.
- The interface text is Hebrew. Math is always rendered left-to-right inside
  `<span class="math" dir="ltr">`.
- No ads, tracking or accounts. Settings and progress stay in `localStorage`, wrapped in
  try/catch, and nothing leaves the device.
- Run `npm test` before committing.
