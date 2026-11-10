// Screens, input and rendering. Question rules and round building live in quiz.js.
(function () {
  'use strict';

  const Quiz = window.Quiz;
  const STORAGE_KEY = 'algebra-quiz-settings';
  const PRAISE = ['נכון!', 'מצוין!', 'בדיוק!', 'יפה מאוד!', 'כל הכבוד!'];
  const OPTION_LETTERS = ['א', 'ב', 'ג', 'ד'];

  const state = {
    level: 1,
    topic: 'all',
    round: [],
    index: 0,
    results: [],
    answered: false,
  };

  const $ = (id) => document.getElementById(id);
  const screens = { start: $('start'), play: $('play'), results: $('results') };

  function show(name) {
    Object.entries(screens).forEach(([key, el]) => (el.hidden = key !== name));
    window.scrollTo(0, 0);
  }

  // ----- Text with $math$ -----

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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
      if (saved.topic) state.topic = saved.topic;
    } catch (e) {
      /* storage unavailable: use defaults */
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ level: state.level, topic: state.topic }));
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
        '<span class="level-name">' + escapeHtml(level.label) + '</span>' +
        '<span class="level-hint">' + escapeHtml(level.hint) + '</span>';
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
    if (state.topic !== 'all' && !topics.some((t) => t.key === state.topic)) state.topic = 'all';
    const box = $('topic-choices');
    box.innerHTML = '';
    [{ key: 'all', label: 'הכול מעורבב' }].concat(topics).forEach((topic) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = topic.label;
      btn.setAttribute('aria-pressed', String(topic.key === state.topic));
      btn.addEventListener('click', () => {
        state.topic = topic.key;
        renderTopics();
      });
      box.appendChild(btn);
    });
    const count = Quiz.poolFor(state.level, state.topic).length;
    $('pool-count').textContent = count + ' שאלות במאגר';
  }

  // ----- Play screen -----

  function startRound(round) {
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
    $('score-text').textContent = state.results.filter((r) => r.correct).length + ' נכונות';
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
  }

  function choose(i) {
    if (state.answered) return;
    state.answered = true;
    const q = state.round[state.index];
    const correct = i === q.answer;
    state.results.push({ question: q, correct });

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
    $('score-text').textContent = state.results.filter((r) => r.correct).length + ' נכונות';
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
    $('final-score').textContent = right + ' / ' + total;
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

  // ----- Wiring -----

  $('start-button').addEventListener('click', () => startRound(Quiz.makeRound(state.level, state.topic)));
  $('again-button').addEventListener('click', () => startRound(Quiz.makeRound(state.level, state.topic)));
  $('retry-wrong-button').addEventListener('click', () => {
    const wrong = state.results.filter((r) => !r.correct).map((r) => r.question);
    startRound(Quiz.roundFrom(wrong));
  });
  $('menu-button').addEventListener('click', () => show('start'));
  $('quit-button').addEventListener('click', () => show('start'));
  $('next-button').addEventListener('click', next);

  document.addEventListener('keydown', (e) => {
    if (screens.play.hidden || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!state.answered && /^[1-4]$/.test(e.key)) choose(Number(e.key) - 1);
    else if (state.answered && e.key === 'Enter' && document.activeElement !== $('next-button')) next();
  });

  loadSettings();
  renderLevels();
  renderTopics();
  show('start');
})();
