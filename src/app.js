// Screens, input and rendering. Question rules and round building live in quiz.js.
(function () {
  'use strict';

  const Quiz = window.Quiz;
  const Progress = window.Progress;
  let progress = Progress.load();
  const STORAGE_KEY = 'algebra-quiz-settings';
  const PRAISE = ['נכון!', 'מצוין!', 'בדיוק!', 'יפה מאוד!', 'כל הכבוד!'];
  const OPTION_LETTERS = ['א', 'ב', 'ג', 'ד'];

  // Small math icons (KaTeX) shown on level cards and topic chips. Decoration only.
  const LEVEL_ICONS = { 1: 'a\\pm b', 2: 'x^2', 3: '|x|', 4: '\\log' };
  const TOPIC_ICONS = {
    all: '\\Sigma',
    order: '\\pm',
    brackets: '(\\,)',
    powers: 'x^n',
    shortmult: '(a{+}b)^2',
    fractions: '\\tfrac{a}{b}',
    linear: '=',
    factoring: '\\times',
    quadratic: 'x^2',
    roots: '\\sqrt{x}',
    abs: '|x|',
    domain: 'x{\\in}',
    inequalities: '<',
    logs: '\\log',
    exponential: 'a^x',
    params: 'k',
  };

  const state = {
    level: 1,
    topics: [], // selected topic keys; empty means all topics mixed
    round: [],
    index: 0,
    results: [],
    answered: false,
    kind: 'normal', // 'normal' | 'retry' (this round's mistakes) | 'mistakes' (saved mistakes)
    // Answer timer for the current question. Time while the page is hidden doesn't count.
    qElapsed: 0, // ms banked before qStart
    qStart: null, // performance.now() when the clock last (re)started; null when stopped
    timerId: null,
  };

  const $ = (id) => document.getElementById(id);
  const screens = { start: $('start'), stats: $('stats'), play: $('play'), results: $('results') };

  function show(name) {
    if (name === 'start') renderStatsCard();
    if (name === 'stats') {
      renderStats();
      refreshGlobalCount();
    }
    Object.entries(screens).forEach(([key, el]) => (el.hidden = key !== name));
    window.scrollTo(0, 0);
  }

  // ----- Text with $math$ -----

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function mathIcon(tex, className) {
    if (!tex || !window.katex) return '';
    return '<span class="' + className + '" dir="ltr" aria-hidden="true">' +
      window.katex.renderToString(tex, { throwOnError: false }) + '</span>';
  }

  function rich(text) {
    return text
      .split('$')
      .map((part, i) => {
        if (i % 2 === 0) return escapeHtml(part);
        const html = window.katex
          ? window.katex.renderToString(part, { throwOnError: false })
          : escapeHtml(part);
        return '<span class="math" dir="ltr">' + html + '</span>';
      })
      .join('');
  }

  // ----- Settings -----

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (Quiz.LEVELS.some((l) => l.id === saved.level)) state.level = saved.level;
      if (Array.isArray(saved.topics)) state.topics = saved.topics.filter((t) => typeof t === 'string');
    } catch (e) {
      /* storage unavailable: use defaults */
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ level: state.level, topics: state.topics }));
    } catch (e) {
      /* ignore */
    }
  }

  // ----- Start screen -----

  function renderLevels() {
    const box = $('level-choices');
    box.innerHTML = '';
    Quiz.LEVELS.forEach((level) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'level';
      btn.setAttribute('aria-pressed', String(level.id === state.level));
      btn.innerHTML =
        mathIcon(LEVEL_ICONS[level.id], 'level-icon') +
        '<span class="level-text">' +
        '<span class="level-name">' + escapeHtml(level.label) + '</span>' +
        (level.hint ? '<span class="level-hint">' + escapeHtml(level.hint) + '</span>' : '') +
        '</span>';
      btn.addEventListener('click', () => {
        state.level = level.id;
        renderLevels();
        renderTopics();
      });
      box.appendChild(btn);
    });
  }

  function renderTopics() {
    const topics = Quiz.topicsForLevel(state.level);
    // Drop selections that this level doesn't offer.
    state.topics = state.topics.filter((key) => topics.some((t) => t.key === key));
    const box = $('topic-choices');
    box.innerHTML = '';
    [{ key: 'all', label: 'הכול מעורבב' }].concat(topics).forEach((topic) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.innerHTML = mathIcon(TOPIC_ICONS[topic.key], 'chip-icon') + '<span>' + escapeHtml(topic.label) + '</span>';
      const pressed = topic.key === 'all' ? state.topics.length === 0 : state.topics.includes(topic.key);
      btn.setAttribute('aria-pressed', String(pressed));
      btn.addEventListener('click', () => toggleTopic(topic.key));
      box.appendChild(btn);
    });
    const count = Quiz.poolFor(state.level, state.topics).length;
    const chosen = state.topics.length;
    $('pool-count').textContent =
      (chosen === 0 ? 'כל הנושאים' : chosen === 1 ? 'נושא אחד נבחר' : chosen + ' נושאים נבחרו') +
      ' · ' + count + ' שאלות במאגר';
  }

  // "הכול מעורבב" clears the selection; choosing a topic adds or removes it.
  // Removing the last selected topic goes back to all topics.
  function toggleTopic(key) {
    if (key === 'all') state.topics = [];
    else if (state.topics.includes(key)) state.topics = state.topics.filter((k) => k !== key);
    else state.topics = state.topics.concat(key);
    renderTopics();
  }

  // ----- Timer -----

  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  function questionMs() {
    return state.qElapsed + (state.qStart !== null ? performance.now() - state.qStart : 0);
  }

  function renderTimer() {
    $('timer').textContent = formatTime(questionMs());
  }

  function startTimer() {
    stopTimer();
    state.qElapsed = 0;
    state.qStart = document.hidden ? null : performance.now();
    renderTimer();
    state.timerId = setInterval(renderTimer, 250);
  }

  // Freezes the clock and returns the time spent on the question.
  function stopTimer() {
    state.qElapsed = questionMs();
    state.qStart = null;
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
    return state.qElapsed;
  }

  document.addEventListener('visibilitychange', () => {
    if (!state.timerId) return; // clock not running
    if (document.hidden && state.qStart !== null) {
      state.qElapsed += performance.now() - state.qStart;
      state.qStart = null;
    } else if (!document.hidden && state.qStart === null) {
      state.qStart = performance.now();
    }
  });

  // ----- Play screen -----

  function newRound() {
    return Quiz.makeRound(state.level, state.topics, { priority: (q) => Progress.priority(progress, q.id) });
  }

  function startRound(round, kind) {
    state.kind = kind || 'normal';
    state.round = round;
    state.index = 0;
    state.results = [];
    saveSettings();
    show('play');
    renderQuestion();
  }

  function renderQuestion() {
    const q = state.round[state.index];
    const total = state.round.length;
    state.answered = false;

    $('progress-text').textContent = 'שאלה ' + (state.index + 1) + ' מתוך ' + total;
    $('score-text').textContent = '✓ ' + state.results.filter((r) => r.correct).length;
    $('progress-bar').style.width = (state.index / total) * 100 + '%';
    $('type-tag').textContent = Quiz.TYPES[q.type];
    $('topic-tag').textContent = Quiz.topicLabel(q.topic);
    $('prompt').innerHTML = rich(q.prompt);

    const steps = $('steps');
    steps.innerHTML = '';
    steps.hidden = !q.steps;
    (q.steps || []).forEach((s, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="step-num">(' + (i + 1) + ')</span> ' + rich(s);
      steps.appendChild(li);
    });

    const options = $('options');
    options.innerHTML = '';
    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option';
      btn.innerHTML = '<span class="option-letter">' + OPTION_LETTERS[i] + '</span><span class="option-text">' + rich(opt) + '</span>';
      btn.addEventListener('click', () => choose(i));
      options.appendChild(btn);
    });

    $('feedback').hidden = true;
    startTimer();
  }

  function choose(i) {
    if (state.answered) return;
    state.answered = true;
    const ms = stopTimer();
    renderTimer();
    const q = state.round[state.index];
    const correct = i === q.answer;
    state.results.push({ question: q, correct, ms });
    Progress.recordAnswer(progress, q.id, correct, Date.now());
    Progress.save(progress);

    const buttons = $('options').querySelectorAll('.option');
    buttons.forEach((btn, j) => {
      btn.disabled = true;
      if (j === q.answer) btn.classList.add('correct');
      else if (j === i) btn.classList.add('wrong');
    });

    const fb = $('feedback');
    fb.className = 'feedback ' + (correct ? 'good' : 'bad');
    $('feedback-title').textContent = correct
      ? PRAISE[Math.floor(Math.random() * PRAISE.length)]
      : 'לא נכון. התשובה הנכונה מסומנת בירוק.';
    $('explanation').innerHTML = rich(q.explanation);
    $('next-button').textContent = state.index + 1 < state.round.length ? 'לשאלה הבאה' : 'לסיכום';
    $('score-text').textContent = '✓ ' + state.results.filter((r) => r.correct).length;
    fb.hidden = false;
    $('next-button').focus({ preventScroll: true });
    fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function next() {
    if (!state.answered) return;
    state.index++;
    if (state.index < state.round.length) renderQuestion();
    else showResults();
  }

  // ----- Results screen -----

  function showResults() {
    const total = state.results.length;
    const right = state.results.filter((r) => r.correct).length;
    const ratio = total ? right / total : 0;
    const totalMs = state.results.reduce((sum, r) => sum + r.ms, 0);
    const avgSeconds = total ? Math.round(totalMs / total / 100) / 10 : 0;
    $('final-time').innerHTML =
      'זמן כולל <strong dir="ltr">' + formatTime(totalMs) + '</strong> · ממוצע <strong dir="ltr">' +
      avgSeconds + '</strong> שניות לשאלה';
    Progress.recordRound(progress, { level: state.level, topics: state.topics, right, total, kind: state.kind, ms: totalMs }, Date.now());
    // Counts rounds where all the questions of a full round were answered.
    if (total >= Quiz.ROUND_LENGTH) countCompletedRound();
    Progress.save(progress);
    $('final-score').textContent = right + '/' + total;
    $('score-ring').style.setProperty('--p', Math.round(ratio * 100));
    $('score-ring').setAttribute('aria-label', right + ' תשובות נכונות מתוך ' + total);
    $('final-message').textContent =
      ratio === 1 ? 'מושלם! אף טעות.' :
      ratio >= 0.8 ? 'מצוין! כמעט בלי טעויות.' :
      ratio >= 0.5 ? 'לא רע. כדאי לחזור על הנושאים שלמטה.' :
      'שווה לתרגל עוד. עברו על ההסברים ונסו שוב.';

    const weak = Quiz.weakTopics(state.results);
    const list = $('weak-topics');
    list.innerHTML = '';
    weak.forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t.label + ' (' + t.mistakes + ')';
      list.appendChild(li);
    });
    $('weak-section').hidden = weak.length === 0;
    $('retry-wrong-button').hidden = weak.length === 0;
    show('results');
  }

  // ----- Progress -----

  function percent(x) {
    return Math.round(x * 100) + '%';
  }

  function daysText(n) {
    return n === 1 ? 'יום אחד' : n + ' ימים';
  }

  function answersText(n) {
    return n === 1 ? 'תשובה אחת' : n + ' תשובות';
  }

  function renderStatsCard() {
    const t = Progress.totals(progress);
    const streak = Progress.streak(progress, Date.now());
    const mistakes = Progress.mistakes(progress, Quiz.QUESTIONS).length;
    $('stats-summary').textContent = t.answers === 0
      ? 'עוד לא התחלת. ההתקדמות תישמר כאן אוטומטית.'
      : [
          answersText(t.answers),
          percent(t.accuracy) + ' דיוק',
          streak > 0 ? daysText(streak) + ' ברצף' : null,
          mistakes === 1 ? 'טעות אחת לתרגול' : mistakes > 1 ? mistakes + ' טעויות לתרגול' : null,
        ].filter(Boolean).join(' · ');
  }

  function renderStats() {
    const t = Progress.totals(progress);
    const empty = t.answers === 0;
    $('stats-empty').hidden = !empty;
    $('stats-body').hidden = empty;
    if (empty) return;

    $('tile-answers').textContent = t.answers;
    $('tile-accuracy').textContent = percent(t.accuracy);
    $('tile-rounds').textContent = t.rounds;
    $('tile-streak').textContent = Progress.streak(progress, Date.now());

    const mistakes = Progress.mistakes(progress, Quiz.QUESTIONS).length;
    const mb = $('mistakes-button');
    mb.hidden = mistakes === 0;
    mb.textContent = 'לתרגל את הטעויות שלי (' + mistakes + ')';

    const list = $('topic-progress');
    list.innerHTML = '';
    Quiz.TOPICS.forEach((topic) => {
      const st = Progress.topicStats(progress, Quiz.QUESTIONS, topic.key);
      const share = st.total ? st.mastered / st.total : 0;
      const li = document.createElement('li');
      li.className = 'topic-row' + (st.seen === 0 ? ' untouched' : '') + (share === 1 ? ' complete' : '');
      li.innerHTML =
        mathIcon(TOPIC_ICONS[topic.key], 'chip-icon') +
        '<div class="topic-row-main">' +
          '<div class="topic-row-head">' +
            '<span class="topic-row-label">' + escapeHtml(topic.label) + '</span>' +
            '<span class="topic-row-count" dir="ltr">' + st.mastered + '/' + st.total + '</span>' +
          '</div>' +
          '<div class="bar"><div class="bar-fill" style="width:' + Math.round(share * 100) + '%"></div></div>' +
          '<span class="topic-row-sub">' +
            (st.seen === 0 ? 'עוד לא תרגלת' : 'דיוק ' + percent(st.correct / st.answers) + ' · ' + answersText(st.answers)) +
          '</span>' +
        '</div>';
      list.appendChild(li);
    });

    const recent = $('recent-rounds');
    recent.innerHTML = '';
    const rounds = progress.rounds.slice(-8).reverse();
    if (rounds.length === 0) {
      recent.innerHTML = '<li class="muted">עוד לא הושלם סבב.</li>';
    }
    rounds.forEach((r) => {
      const level = Quiz.LEVELS.find((l) => l.id === r.level);
      const what =
        r.kind === 'mistakes' ? 'תרגול הטעויות שלי' :
        r.kind === 'retry' ? 'חזרה על טעויות הסבב' :
        (level ? level.label : '') + ' · ' +
          (r.topics && r.topics.length ? (r.topics.length === 1 ? Quiz.topicLabel(r.topics[0]) : r.topics.length + ' נושאים') : 'כל הנושאים');
      const date = new Date(r.t).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
      const li = document.createElement('li');
      li.innerHTML =
        '<span class="round-date">' + escapeHtml(date) + '</span>' +
        '<span class="round-what">' + escapeHtml(what) + '</span>' +
        (typeof r.ms === 'number' ? '<span class="round-time" dir="ltr">' + formatTime(r.ms) + '</span>' : '') +
        '<span class="round-score" dir="ltr">' + r.right + '/' + r.total + '</span>';
      recent.appendChild(li);
    });
  }

  // ----- Public counter of completed rounds -----

  function formatCount(n) {
    return n.toLocaleString('he-IL');
  }

  let globalCount = null; // last known total, null when the service is unavailable

  // Shown on the start screen and the progress screen, including when it is still 0.
  function renderGlobalCount(n) {
    if (typeof n === 'number') globalCount = n;
    const el = $('global-count');
    const card = $('stats-global');
    if (typeof globalCount !== 'number') {
      el.hidden = true;
      card.hidden = true;
      return;
    }
    el.innerHTML = '<strong dir="ltr">' + formatCount(globalCount) + '</strong> ' +
      (globalCount === 1 ? 'סבב הושלם באתר עד היום' : 'סבבים הושלמו באתר עד היום');
    el.hidden = false;

    $('stats-global-num').textContent = formatCount(globalCount);
    $('stats-global-label').textContent =
      (globalCount === 1 ? 'סבב הושלם' : 'סבבים הושלמו') + ' באתר עד היום, אצל כל המשתמשים';
    card.hidden = false;
  }

  function refreshGlobalCount() {
    if (window.Counter) window.Counter.get().then(renderGlobalCount);
  }

  // ----- New version check -----
  // Phones often keep an old copy of the page (cache, or a frozen tab). When the page
  // becomes visible again, compare our version with the live index.html and offer a reload.

  const APP_VERSION = (document.querySelector('meta[name="app-version"]') || {}).content;
  let lastUpdateCheck = 0;

  function checkForUpdate() {
    if (!APP_VERSION || typeof fetch !== 'function' || location.protocol === 'file:') return;
    const now = Date.now();
    if (now - lastUpdateCheck < 60 * 1000) return;
    lastUpdateCheck = now;
    fetch('index.html?check=' + now, { cache: 'no-store' })
      .then((res) => (res.ok ? res.text() : ''))
      .then((html) => {
        const m = html.match(/<meta name="app-version" content="([^"]+)"/);
        if (m && m[1] !== APP_VERSION) $('update-banner').hidden = false;
      })
      .catch(() => {});
  }

  $('update-button').addEventListener('click', () => location.reload());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkForUpdate();
      refreshGlobalCount();
    }
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) checkForUpdate(); // restored from the back/forward cache
  });
  setTimeout(checkForUpdate, 2000);

  function countCompletedRound() {
    $('final-global').hidden = true;
    if (!window.Counter) return;
    window.Counter.hit().then((n) => {
      renderGlobalCount(n);
      if (typeof n === 'number' && n > 0 && window.Counter.counts) {
        $('final-global').innerHTML = 'זה הסבב ה-<strong dir="ltr">' + formatCount(n) + '</strong> שהושלם באתר';
        $('final-global').hidden = false;
      }
    });
  }

  // ----- Wiring -----

  $('start-button').addEventListener('click', () => startRound(newRound()));
  $('again-button').addEventListener('click', () => startRound(newRound()));
  $('retry-wrong-button').addEventListener('click', () => {
    const wrong = state.results.filter((r) => !r.correct).map((r) => r.question);
    startRound(Quiz.roundFrom(wrong), 'retry');
  });
  $('stats-card').addEventListener('click', () => show('stats'));
  $('stats-back-button').addEventListener('click', () => show('start'));
  $('mistakes-button').addEventListener('click', () => {
    const wrong = Progress.mistakes(progress, Quiz.QUESTIONS);
    if (wrong.length) startRound(Quiz.roundFrom(wrong, undefined, Quiz.ROUND_LENGTH), 'mistakes');
  });
  $('reset-button').addEventListener('click', () => {
    if (window.confirm('למחוק את כל ההתקדמות השמורה? אי אפשר לבטל את זה.')) {
      progress = Progress.clear();
      renderStats();
    }
  });
  $('menu-button').addEventListener('click', () => show('start'));
  $('quit-button').addEventListener('click', () => {
    stopTimer();
    show('start');
  });
  $('next-button').addEventListener('click', next);

  document.addEventListener('keydown', (e) => {
    if (screens.play.hidden || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!state.answered && /^[1-4]$/.test(e.key)) choose(Number(e.key) - 1);
    else if (state.answered && e.key === 'Enter' && document.activeElement !== $('next-button')) next();
  });

  refreshGlobalCount();
  loadSettings();
  renderLevels();
  renderTopics();
  show('start');
})();
