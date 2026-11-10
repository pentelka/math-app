# אלגברה בלי טעויות (Math App)

Multiple-choice practice on the rules of algebra, focused on the mistakes students
actually make, from the basics up to the 5-unit (5 יח״ל) Bagrut level. The interface
is in Hebrew.

- **Choose a level, then one or more topics.** Levels: יסודות (grades 8–9), 3 יח״ל, 4 יח״ל and
  5 יח״ל. Topics: order of operations and signs, expanding brackets, exponent rules,
  special products, algebraic fractions, linear equations and inequalities,
  factoring, quadratic equations, roots, absolute value, domain and extraneous
  solutions, inequalities, logarithms, exponential equations and parameters. Pick any combination of
  topics, or "הכול מעורבב" for all topics up to the chosen level.
- **Four answers per question.** The wrong answers are the common mistakes, such as
  $(a+b)^2=a^2+b^2$, $\sqrt{a+b}=\sqrt a+\sqrt b$ or forgetting to flip an
  inequality.
- **Four question styles, mixed in each round:** what does it equal, which step is
  correct, where is the mistake in a worked solution, and when does the rule hold.
- **An explanation right after each answer.** It shows which rule was broken and
  what the correct version is.
- **Rounds of 10.** At the end you get your score, the topics you got wrong, and a
  button to practise just the questions you missed.
- **Progress saved over time** in the browser: answers, accuracy, rounds, days in a
  row, mastery per topic and recent rounds. Questions answered wrong, or not yet
  seen, come up more often. A "practise my mistakes" round collects the questions
  whose last answer was wrong. Progress stays on that device and browser only, with
  no account.
- **A timer for each question.** It counts up and is never a limit. The results show
  the total time and the average per question.
- No calculations that need pen and paper.

## Play it

**https://pentelka.github.io/math-app/**

Or open `index.html` in a web browser. It works offline, on phones and computers, with
nothing to install. On a keyboard, press 1–4 to answer and Enter for the next question.

Or serve the folder and open http://localhost:8000:

```bash
npm start
```

## Develop

The tests need Node 18 or newer. There are no packages to install.

```bash
npm test
```

The tests check every question in the bank: four distinct options, a valid correct
answer, a level and topic, and math that renders.

See [AGENTS.md](AGENTS.md) for how the code is organised and how to add questions.
