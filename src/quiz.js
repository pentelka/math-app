// Quiz logic: levels, topics, building a round and shuffling answers.
// Pure functions with no DOM access, loaded as a plain <script> in the browser and with
// require() in tests.
(function (root) {
  'use strict';

  const QUESTIONS =
    typeof module !== 'undefined' && module.exports ? require('./bank.js').QUESTIONS : root.QUESTION_BANK;

  const LEVELS = [
    { id: 1, label: 'יסודות', hint: 'כיתות ח׳–ט׳' },
    { id: 2, label: '3 יח״ל', hint: 'פירוק, משוואות ריבועיות, שורשים' },
    { id: 3, label: '4 יח״ל', hint: 'ערך מוחלט, תחום הגדרה, אי-שוויונות' },
    { id: 4, label: '5 יח״ל', hint: 'לוגריתמים ומשוואות מעריכיות' },
  ];

  // In display order. A topic is offered from its minLevel upwards.
  const TOPICS = [
    { key: 'order', label: 'סדר פעולות וסימנים', minLevel: 1 },
    { key: 'brackets', label: 'פתיחת סוגריים וכינוס', minLevel: 1 },
    { key: 'powers', label: 'חוקי חזקות', minLevel: 1 },
    { key: 'shortmult', label: 'כפל מקוצר', minLevel: 1 },
    { key: 'fractions', label: 'שברים אלגבריים', minLevel: 1 },
    { key: 'linear', label: 'משוואות ואי-שוויונות קוויים', minLevel: 1 },
    { key: 'factoring', label: 'פירוק לגורמים', minLevel: 2 },
    { key: 'quadratic', label: 'משוואות ריבועיות', minLevel: 2 },
    { key: 'roots', label: 'שורשים', minLevel: 2 },
    { key: 'abs', label: 'ערך מוחלט', minLevel: 3 },
    { key: 'domain', label: 'תחום הגדרה ופתרונות זרים', minLevel: 3 },
    { key: 'inequalities', label: 'אי-שוויונות', minLevel: 3 },
    { key: 'logs', label: 'לוגריתמים', minLevel: 4 },
    { key: 'exponential', label: 'משוואות מעריכיות', minLevel: 4 },
  ];

  const TYPES = {
    value: 'למה שווה?',
    step: 'איזה מעבר נכון?',
    error: 'איפה הטעות?',
    condition: 'מתי זה נכון?',
  };

  const ROUND_LENGTH = 10;
  // Questions from the chosen level are this many times likelier than easier ones,
  // so a 5 יח״ל round is mostly 5 יח״ל material but still revisits the basics.
  const SAME_LEVEL_WEIGHT = 3;

  function topicLabel(key) {
    const t = TOPICS.find((x) => x.key === key);
    return t ? t.label : key;
  }

  // topics: 'all', an empty array (also all), a topic key, or an array of topic keys.
  function poolFor(level, topics, questions) {
    questions = questions || QUESTIONS;
    const all = topics === 'all' || (Array.isArray(topics) && topics.length === 0);
    const keys = Array.isArray(topics) ? topics : [topics];
    return questions.filter((q) => q.level <= level && (all || keys.includes(q.topic)));
  }

  function topicsForLevel(level, questions) {
    return TOPICS.filter((t) => t.minLevel <= level && poolFor(level, t.key, questions).length > 0);
  }

  // Weighted sampling without replacement. `priority` (optional) scales each question's
  // weight, e.g. to favour questions answered wrong before (see progress.js).
  function sample(pool, level, count, random, priority) {
    const items = pool.slice();
    const picked = [];
    while (picked.length < count && items.length > 0) {
      const weights = items.map(
        (q) => (q.level === level ? SAME_LEVEL_WEIGHT : 1) * (priority ? priority(q) : 1)
      );
      const total = weights.reduce((a, b) => a + b, 0);
      let x = random() * total;
      let i = 0;
      while (i < items.length - 1 && x >= weights[i]) {
        x -= weights[i];
        i++;
      }
      picked.push(items.splice(i, 1)[0]);
    }
    return picked;
  }

  // Reorder so that neighbouring questions differ in type, and in topic when possible,
  // to keep a round varied.
  function vary(questions) {
    const rest = questions.slice();
    const out = [];
    while (rest.length > 0) {
      const prev = out[out.length - 1];
      let i = prev ? rest.findIndex((q) => q.type !== prev.type && q.topic !== prev.topic) : 0;
      if (i < 0) i = rest.findIndex((q) => q.type !== prev.type);
      if (i < 0) i = 0;
      out.push(rest.splice(i, 1)[0]);
    }
    return out;
  }

  // Returns a copy of the question with options shuffled (unless `ordered`) and `answer`
  // pointing at the correct option's new position.
  function prepare(question, random) {
    random = random || Math.random;
    const correct = question.answer || 0;
    const order = question.options.map((_, i) => i);
    if (!question.ordered) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    return Object.assign({}, question, {
      options: order.map((i) => question.options[i]),
      answer: order.indexOf(correct),
    });
  }

  function makeRound(level, topics, options) {
    options = options || {};
    const random = options.random || Math.random;
    const count = options.count || ROUND_LENGTH;
    const pool = poolFor(level, topics, options.questions);
    return vary(sample(pool, level, count, random, options.priority)).map((q) => prepare(q, random));
  }

  // Builds a round from specific questions (e.g. the ones answered wrong), at most
  // `count` of them when given.
  function roundFrom(questions, random, count) {
    random = random || Math.random;
    const shuffled = sample(questions, 0, Math.min(count || questions.length, questions.length), random);
    return vary(shuffled).map((q) => prepare(q, random));
  }

  // results: [{ question, correct }] → topics with mistakes, most mistakes first.
  function weakTopics(results) {
    const counts = {};
    results.forEach((r) => {
      if (!r.correct) counts[r.question.topic] = (counts[r.question.topic] || 0) + 1;
    });
    return Object.keys(counts)
      .sort((a, b) => counts[b] - counts[a])
      .map((key) => ({ key, label: topicLabel(key), mistakes: counts[key] }));
  }

  const api = {
    LEVELS,
    TOPICS,
    TYPES,
    ROUND_LENGTH,
    QUESTIONS,
    topicLabel,
    poolFor,
    topicsForLevel,
    prepare,
    makeRound,
    roundFrom,
    weakTopics,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Quiz = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
