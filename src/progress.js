// Progress saved over time, in this browser only (localStorage). No accounts, no server.
//
// Shape (version 1):
//   questions: { [questionId]: { seen, correct, streak, last: 'right'|'wrong', lastSeen } }
//   rounds:    [{ t, level, topics, right, total, kind, ms }]  most recent last, capped;
//              ms = total answering time
//   days:      ['YYYY-MM-DD', ...]                           local days with practice, capped
//
// The functions below are pure (they take `now` as a timestamp) so they can be tested in
// Node. Only load/save/clear touch localStorage, and they never throw.
(function (root) {
  'use strict';

  const STORAGE_KEY = 'algebra-quiz-progress-v1';
  const MAX_ROUNDS = 200;
  const MAX_DAYS = 800;

  function empty() {
    return { version: 1, questions: {}, rounds: [], days: [] };
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  // Local calendar day, so a streak follows the student's own midnight.
  function dayKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function previousDay(key) {
    const [y, m, d] = key.split('-').map(Number);
    return dayKey(new Date(y, m - 1, d - 1, 12).getTime());
  }

  // Accept only data that looks like ours; anything else starts fresh.
  function normalize(data) {
    if (!data || typeof data !== 'object' || data.version !== 1) return empty();
    const p = empty();
    if (data.questions && typeof data.questions === 'object') {
      Object.keys(data.questions).forEach((id) => {
        const s = data.questions[id];
        if (s && typeof s.seen === 'number' && typeof s.correct === 'number') {
          p.questions[id] = {
            seen: s.seen,
            correct: s.correct,
            streak: typeof s.streak === 'number' ? s.streak : 0,
            last: s.last === 'right' || s.last === 'wrong' ? s.last : null,
            lastSeen: typeof s.lastSeen === 'number' ? s.lastSeen : 0,
          };
        }
      });
    }
    if (Array.isArray(data.rounds)) {
      p.rounds = data.rounds
        .filter((r) => r && typeof r.right === 'number' && typeof r.total === 'number')
        .slice(-MAX_ROUNDS);
    }
    if (Array.isArray(data.days)) {
      p.days = data.days.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-MAX_DAYS);
    }
    return p;
  }

  function recordAnswer(p, id, correct, now) {
    const s = p.questions[id] || { seen: 0, correct: 0, streak: 0, last: null, lastSeen: 0 };
    s.seen++;
    if (correct) {
      s.correct++;
      s.streak++;
    } else {
      s.streak = 0;
    }
    s.last = correct ? 'right' : 'wrong';
    s.lastSeen = now;
    p.questions[id] = s;

    const day = dayKey(now);
    if (!p.days.includes(day)) {
      p.days.push(day);
      if (p.days.length > MAX_DAYS) p.days.shift();
    }
    return p;
  }

  function recordRound(p, round, now) {
    p.rounds.push({
      t: now,
      level: round.level,
      topics: round.topics || [],
      right: round.right,
      total: round.total,
      kind: round.kind || 'normal',
      ms: typeof round.ms === 'number' ? Math.round(round.ms) : undefined,
    });
    if (p.rounds.length > MAX_ROUNDS) p.rounds.splice(0, p.rounds.length - MAX_ROUNDS);
    return p;
  }

  // How much more (or less) likely a question should be in the next round.
  function priority(p, id) {
    const s = p.questions[id];
    if (!s) return 2; // never seen
    if (s.last === 'wrong') return 3; // got it wrong last time
    if (s.streak >= 2) return 0.5; // right twice or more in a row
    return 1;
  }

  function totals(p) {
    let answers = 0;
    let correct = 0;
    Object.values(p.questions).forEach((s) => {
      answers += s.seen;
      correct += s.correct;
    });
    return {
      answers,
      correct,
      accuracy: answers ? correct / answers : 0,
      rounds: p.rounds.length,
      days: p.days.length,
    };
  }

  // Consecutive practice days ending today, or ending yesterday if not yet practised today.
  function streak(p, now) {
    const days = new Set(p.days);
    let day = dayKey(now);
    if (!days.has(day)) day = previousDay(day);
    let count = 0;
    while (days.has(day)) {
      count++;
      day = previousDay(day);
    }
    return count;
  }

  // For one topic: how many of its questions were answered right the last time.
  function topicStats(p, questions, topic) {
    const qs = questions.filter((q) => q.topic === topic);
    const out = { total: qs.length, seen: 0, mastered: 0, answers: 0, correct: 0 };
    qs.forEach((q) => {
      const s = p.questions[q.id];
      if (!s) return;
      out.seen++;
      out.answers += s.seen;
      out.correct += s.correct;
      if (s.last === 'right') out.mastered++;
    });
    return out;
  }

  // Questions whose most recent answer was wrong.
  function mistakes(p, questions) {
    return questions.filter((q) => p.questions[q.id] && p.questions[q.id].last === 'wrong');
  }

  function load() {
    try {
      return normalize(JSON.parse(root.localStorage.getItem(STORAGE_KEY) || 'null'));
    } catch (e) {
      return empty();
    }
  }

  function save(p) {
    try {
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    try {
      root.localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
    return empty();
  }

  const api = {
    STORAGE_KEY,
    empty,
    dayKey,
    normalize,
    recordAnswer,
    recordRound,
    priority,
    totals,
    streak,
    topicStats,
    mistakes,
    load,
    save,
    clear,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Progress = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
