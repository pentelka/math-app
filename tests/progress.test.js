const test = require('node:test');
const assert = require('node:assert/strict');
const Progress = require('../src/progress.js');
const Quiz = require('../src/quiz.js');

// Noon local time on a given day, so day arithmetic is unambiguous.
const at = (y, m, d) => new Date(y, m - 1, d, 12).getTime();

function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

test('recordAnswer counts answers, correct answers and streaks', () => {
  const p = Progress.empty();
  Progress.recordAnswer(p, 'q1', true, at(2026, 11, 10));
  Progress.recordAnswer(p, 'q1', true, at(2026, 11, 10));
  assert.deepEqual(
    { seen: p.questions.q1.seen, correct: p.questions.q1.correct, streak: p.questions.q1.streak, last: p.questions.q1.last },
    { seen: 2, correct: 2, streak: 2, last: 'right' },
  );
  Progress.recordAnswer(p, 'q1', false, at(2026, 11, 11));
  assert.equal(p.questions.q1.streak, 0);
  assert.equal(p.questions.q1.last, 'wrong');
  assert.deepEqual(p.days, ['2026-11-10', '2026-11-11']);
});

test('priority favours unseen and wrong questions, and eases off mastered ones', () => {
  const p = Progress.empty();
  const now = at(2026, 11, 10);
  Progress.recordAnswer(p, 'wrong', false, now);
  Progress.recordAnswer(p, 'once', true, now);
  Progress.recordAnswer(p, 'twice', true, now);
  Progress.recordAnswer(p, 'twice', true, now);
  assert.equal(Progress.priority(p, 'never'), 2);
  assert.equal(Progress.priority(p, 'wrong'), 3);
  assert.equal(Progress.priority(p, 'once'), 1);
  assert.equal(Progress.priority(p, 'twice'), 0.5);
});

test('totals add up across questions and rounds', () => {
  const p = Progress.empty();
  const now = at(2026, 11, 10);
  Progress.recordAnswer(p, 'a', true, now);
  Progress.recordAnswer(p, 'b', false, now);
  Progress.recordAnswer(p, 'b', true, now);
  Progress.recordRound(p, { level: 2, topics: [], right: 2, total: 3 }, now);
  const t = Progress.totals(p);
  assert.equal(t.answers, 3);
  assert.equal(t.correct, 2);
  assert.equal(t.rounds, 1);
  assert.ok(Math.abs(t.accuracy - 2 / 3) < 1e-9);
});

test('streak counts consecutive days ending today or yesterday', () => {
  const p = Progress.empty();
  p.days = ['2026-11-01', '2026-11-08', '2026-11-09', '2026-11-10'];
  assert.equal(Progress.streak(p, at(2026, 11, 10)), 3);
  assert.equal(Progress.streak(p, at(2026, 11, 11)), 3, 'not practised yet today keeps the streak');
  assert.equal(Progress.streak(p, at(2026, 11, 12)), 0, 'a missed day breaks it');
  assert.equal(Progress.streak(Progress.empty(), at(2026, 11, 10)), 0);
});

test('streak works across a month boundary', () => {
  const p = Progress.empty();
  p.days = ['2026-10-30', '2026-10-31', '2026-11-01'];
  assert.equal(Progress.streak(p, at(2026, 11, 1)), 3);
});

test('topicStats and mistakes use the last answer per question', () => {
  const p = Progress.empty();
  const now = at(2026, 11, 10);
  const logs = Quiz.QUESTIONS.filter((q) => q.topic === 'logs');
  Progress.recordAnswer(p, logs[0].id, true, now);
  Progress.recordAnswer(p, logs[1].id, false, now);
  Progress.recordAnswer(p, logs[2].id, false, now);
  Progress.recordAnswer(p, logs[2].id, true, now);
  const s = Progress.topicStats(p, Quiz.QUESTIONS, 'logs');
  assert.equal(s.total, logs.length);
  assert.equal(s.seen, 3);
  assert.equal(s.mastered, 2);
  assert.equal(s.answers, 4);
  assert.equal(s.correct, 2);
  assert.deepEqual(Progress.mistakes(p, Quiz.QUESTIONS).map((q) => q.id), [logs[1].id]);
});

test('rounds are capped so storage stays small', () => {
  const p = Progress.empty();
  for (let i = 0; i < 250; i++) Progress.recordRound(p, { level: 1, right: 1, total: 10 }, i);
  assert.equal(p.rounds.length, 200);
  assert.equal(p.rounds[0].t, 50);
});

test('normalize survives missing, foreign or corrupted data', () => {
  assert.deepEqual(Progress.normalize(null), Progress.empty());
  assert.deepEqual(Progress.normalize({ version: 2 }), Progress.empty());
  const p = Progress.normalize({
    version: 1,
    questions: { ok: { seen: 2, correct: 1, streak: 1, last: 'right', lastSeen: 5 }, bad: { seen: 'x' } },
    rounds: [{ right: 3, total: 10 }, null, 'junk'],
    days: ['2026-11-10', 'not a day', 7],
  });
  assert.deepEqual(Object.keys(p.questions), ['ok']);
  assert.equal(p.rounds.length, 1);
  assert.deepEqual(p.days, ['2026-11-10']);
});

test('load and save never throw without localStorage', () => {
  assert.deepEqual(Progress.load(), Progress.empty());
  assert.equal(Progress.save(Progress.empty()), false);
});

test('a round with priority prefers questions answered wrong before', () => {
  const p = Progress.empty();
  const now = at(2026, 11, 10);
  const pool = Quiz.poolFor(1, 'all');
  // Mark every level-1 question as mastered except five answered wrong.
  const wrong = new Set(pool.slice(0, 5).map((q) => q.id));
  pool.forEach((q) => {
    if (wrong.has(q.id)) Progress.recordAnswer(p, q.id, false, now);
    else {
      Progress.recordAnswer(p, q.id, true, now);
      Progress.recordAnswer(p, q.id, true, now);
    }
  });
  const random = seeded(5);
  let hits = 0;
  const rounds = 300;
  for (let i = 0; i < rounds; i++) {
    const round = Quiz.makeRound(1, 'all', { random, priority: (q) => Progress.priority(p, q.id) });
    hits += round.filter((q) => wrong.has(q.id)).length;
  }
  // Without priority, 10 picks from the pool would include about 10 * 5 / pool.length of them.
  const baseline = (10 * 5) / pool.length;
  assert.ok(hits / rounds > baseline * 2, `wrong questions per round: ${hits / rounds}, baseline ${baseline}`);
});

test('roundFrom respects the count limit', () => {
  const qs = Quiz.QUESTIONS.slice(0, 25);
  assert.equal(Quiz.roundFrom(qs, seeded(1), 10).length, 10);
  assert.equal(Quiz.roundFrom(qs.slice(0, 4), seeded(1), 10).length, 4);
});
