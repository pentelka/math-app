const test = require('node:test');
const assert = require('node:assert/strict');
const katex = require('../vendor/katex/katex.min.js');
const Quiz = require('../src/quiz.js');

const { QUESTIONS, LEVELS, TOPICS, TYPES } = Quiz;
const LEVEL_IDS = LEVELS.map((l) => l.id);
const TOPIC_BY_KEY = Object.fromEntries(TOPICS.map((t) => [t.key, t]));

// Deterministic random for repeatable tests.
function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function mathParts(text) {
  return text.split('$').filter((_, i) => i % 2 === 1);
}

test('question ids are unique', () => {
  const ids = QUESTIONS.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length);
});

for (const q of QUESTIONS) {
  test(`question ${q.id} is well formed`, () => {
    assert.ok(LEVEL_IDS.includes(q.level), 'level');
    assert.ok(TOPIC_BY_KEY[q.topic], 'topic');
    assert.ok(TOPIC_BY_KEY[q.topic].minLevel <= q.level, 'topic is offered at this level');
    assert.ok(TYPES[q.type], 'type');
    assert.ok(q.prompt && q.prompt.trim(), 'prompt');
    assert.ok(q.explanation && q.explanation.trim(), 'explanation');
    assert.equal(q.options.length, 4, 'four options');
    assert.equal(new Set(q.options.map((o) => o.replace(/\s/g, ''))).size, 4, 'options are distinct');
    const answer = q.answer || 0;
    assert.ok(Number.isInteger(answer) && answer >= 0 && answer < 4, 'answer index');
    if (q.type === 'error') {
      assert.ok(Array.isArray(q.steps) && q.steps.length >= 2, 'error questions have steps');
      assert.equal(q.ordered, true, 'error questions keep option order');
    } else {
      assert.equal(q.steps, undefined, 'only error questions have steps');
    }
  });

  test(`question ${q.id} math renders`, () => {
    const texts = [q.prompt, q.explanation, ...q.options, ...(q.steps || [])];
    for (const text of texts) {
      assert.equal((text.match(/\$/g) || []).length % 2, 0, `unbalanced $ in: ${text}`);
      for (const part of mathParts(text)) {
        assert.doesNotThrow(() => katex.renderToString(part, { throwOnError: true }), part);
      }
    }
  });
}

test('every topic has questions', () => {
  for (const t of TOPICS) {
    assert.ok(QUESTIONS.some((q) => q.topic === t.key), t.key);
  }
});

test('every level has questions of its own', () => {
  for (const id of LEVEL_IDS) {
    assert.ok(QUESTIONS.filter((q) => q.level === id).length >= 10, `level ${id}`);
  }
});

test('topicsForLevel only offers topics up to the level', () => {
  for (const id of LEVEL_IDS) {
    for (const t of Quiz.topicsForLevel(id)) assert.ok(t.minLevel <= id);
  }
  assert.ok(!Quiz.topicsForLevel(1).some((t) => t.key === 'logs'));
  assert.ok(Quiz.topicsForLevel(4).some((t) => t.key === 'logs'));
});

test('prepare shuffles options and keeps the right answer', () => {
  const random = seeded(7);
  for (const q of QUESTIONS) {
    for (let i = 0; i < 5; i++) {
      const p = Quiz.prepare(q, random);
      assert.equal(p.options[p.answer], q.options[q.answer || 0]);
      assert.deepEqual([...p.options].sort(), [...q.options].sort());
      if (q.ordered) assert.deepEqual(p.options, q.options);
    }
  }
});

test('makeRound returns 10 distinct questions within level and topic', () => {
  const random = seeded(42);
  for (const level of LEVEL_IDS) {
    for (const topic of ['all', ...Quiz.topicsForLevel(level).map((t) => t.key)]) {
      const round = Quiz.makeRound(level, topic, { random });
      const poolSize = Quiz.poolFor(level, topic).length;
      assert.equal(round.length, Math.min(10, poolSize));
      assert.equal(new Set(round.map((q) => q.id)).size, round.length);
      for (const q of round) {
        assert.ok(q.level <= level);
        if (topic !== 'all') assert.equal(q.topic, topic);
      }
    }
  }
});

test('several topics: the pool is their union and a round stays inside it', () => {
  const random = seeded(11);
  const topics = ['logs', 'powers', 'abs'];
  const pool = Quiz.poolFor(4, topics);
  const expected = topics.map((t) => Quiz.poolFor(4, t).length).reduce((a, b) => a + b, 0);
  assert.equal(pool.length, expected);
  for (let i = 0; i < 50; i++) {
    const round = Quiz.makeRound(4, topics, { random });
    assert.equal(round.length, 10);
    for (const q of round) assert.ok(topics.includes(q.topic), q.topic);
  }
});

test('an empty topic list means all topics', () => {
  for (const id of LEVEL_IDS) {
    assert.equal(Quiz.poolFor(id, []).length, Quiz.poolFor(id, 'all').length);
  }
});

test('a mixed round is mostly from the chosen level and mixes question types', () => {
  const random = seeded(3);
  let sameLevel = 0;
  let total = 0;
  let typeRepeats = 0;
  for (let i = 0; i < 200; i++) {
    const round = Quiz.makeRound(4, 'all', { random });
    sameLevel += round.filter((q) => q.level === 4).length;
    total += round.length;
    for (let j = 1; j < round.length; j++) if (round[j].type === round[j - 1].type) typeRepeats++;
  }
  assert.ok(sameLevel / total > 0.35, `share of level-4 questions: ${sameLevel / total}`);
  // Most questions are 'value', so some repeats are unavoidable; check they're kept low.
  assert.ok(typeRepeats / total < 0.5, `type repeats per question: ${typeRepeats / total}`);
});

test('weakTopics counts mistakes per topic, most first', () => {
  const q = (topic) => ({ topic });
  const weak = Quiz.weakTopics([
    { question: q('logs'), correct: false },
    { question: q('roots'), correct: false },
    { question: q('logs'), correct: false },
    { question: q('abs'), correct: true },
  ]);
  assert.deepEqual(
    weak.map((w) => [w.key, w.mistakes]),
    [
      ['logs', 2],
      ['roots', 1],
    ],
  );
});
