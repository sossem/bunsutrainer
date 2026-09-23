/* Optional rewards are separate from mathematical correctness and study records. */
(function (root) {
  'use strict';
  const KEY = 'bunsu.game.v1';
  const RULES = Object.freeze({
    correct: 100, difficulty: Object.freeze({ easy: 1, normal: 2, challenge: 3 }), firstAttempt: 50,
    comboThreshold: 2, comboStep: 100, comboBonusMax: 500, speed: 0, speedRatio: 0.5,
    xpPerCorrect: 5, completionXp: 20, challengeXpPerCorrect: 2, dailyCompletionXp: 5,
    xpPerLevel: 100, journalLimit: 5000,
    classCompletion: 10, classPerFirstCorrect: 5, classAccuracy: 20, classMinimumQuestions: 5
  });
  const UNITS = Object.freeze({ 'g4-addsub': '4학년 덧셈과 뺄셈', 'g5-equivalence': '약분과 통분', 'g5-addsub': '5학년 덧셈과 뺄셈', 'g5-multiply': '분수의 곱셈', 'g6-divide': '분수의 나눗셈' });
  const BADGES = [
    { id: 'first-session', title: '첫 걸음', description: '첫 학습을 끝까지 마쳤어요.' },
    { id: 'combo-10', title: '차근차근 열 번', description: '도움 없이 첫 시도에 10문제를 연속으로 맞혔어요.' },
    { id: 'solved-100', title: '백 번의 배움', description: '분수 문제를 100개 해결했어요.' },
    { id: 'streak-7', title: '일주일의 습관', description: '7일 연속으로 분수를 공부했어요.' },
    ...Object.entries(UNITS).map(([unit, title]) => ({ id: `mastery-${unit}`, title: `${title} 탐험가`, description: '이 단원에서 첫 시도 정답을 20개 쌓았어요.' }))
  ];
  const copy = value => JSON.parse(JSON.stringify(value));
  const safeInt = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
  const add = (a, b) => Math.min(Number.MAX_SAFE_INTEGER, a + b);
  const TYPE_POINTS = Object.freeze({
    'g4-addsub': Object.freeze({ 'proper-add':100, 'proper-sub':100, 'one-minus':100, 'improper-add':150, 'mixed-add':200, 'mixed-sub':200, 'whole-minus-mixed':250 }),
    'g5-equivalence': Object.freeze({ equivalent:100, simplify:150, irreducible:150, 'common-denominator':200, common:250, compare:200 }),
    'g5-addsub': Object.freeze({ 'proper-add':200, 'proper-sub':200, 'mixed-proper-add':250, 'mixed-proper-sub':250, 'mixed-add':300, 'mixed-sub':300, borrow:300 }),
    'g5-multiply': Object.freeze({ 'natural-fraction':150, 'fraction-natural':150, 'proper-multiply':200, 'mixed-multiply':300, cancellation:250 }),
    'g6-divide': Object.freeze({ 'fraction-natural':200, 'natural-fraction':250, 'fraction-fraction':250, 'mixed-divide':300 })
  });
  function baseScore({ unit, type, difficulty } = {}) {
    const points = type === 'all' ? 500 : ['addition', 'subtraction'].includes(type) ? 350 : TYPE_POINTS[unit]?.[type];
    const multiplier = Object.hasOwn(RULES.difficulty, difficulty) ? RULES.difficulty[difficulty] : 1;
    return (typeof points === 'number' ? points : RULES.correct) * multiplier;
  }
  function maxAnswerScore(settings, speedEnabled = false) { return baseScore(settings) + RULES.firstAttempt + RULES.comboBonusMax + (speedEnabled ? Math.round(baseScore(settings) * 0.5) : 0); }
  function scoreAnswer(answer = {}) {
    if (!answer.correct || answer.revealed) return { score: 0, combo: 0, bonus: 0 };
    const base = baseScore(answer);
    const unassisted = answer.firstAttempt === true && !answer.hintUsed && !answer.timedOut;
    const combo = unassisted ? (safeInt(answer.combo, 10000) ? answer.combo : 0) + 1 : 0;
    const comboBonus = unassisted && combo >= RULES.comboThreshold ? Math.min(RULES.comboBonusMax, (combo - RULES.comboThreshold + 1) * RULES.comboStep) : 0;
    const speedBonus = unassisted && answer.speedEnabled && Number.isFinite(answer.solveSeconds) && answer.solveSeconds >= 0
      ? Math.round(base * 0.5 * Math.max(0, 1 - answer.solveSeconds / 60)) : 0;
    const bonus = (unassisted ? RULES.firstAttempt : 0) + comboBonus + speedBonus;
    return { score: base + bonus, combo, bonus, ...(answer.speedEnabled ? { speedBonus } : {}) };
  }
  function validRecord(record) {
    return record && typeof record === 'object' && typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 160
      && typeof record.date === 'string' && Number.isFinite(Date.parse(record.date))
      && safeInt(record.total, 200) && record.total > 0 && safeInt(record.correct, record.total)
      && safeInt(record.firstCorrect, record.correct) && record.settings && typeof record.settings === 'object';
  }
  function classContribution(record) {
    if (!record || record.completed !== true || !safeInt(record.total, 200) || record.total < RULES.classMinimumQuestions || !safeInt(record.firstCorrect, record.total)) return 0;
    return RULES.classCompletion + RULES.classPerFirstCorrect * record.firstCorrect + Math.round(record.firstCorrect / record.total * RULES.classAccuracy);
  }
  const dayOf = value => new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dayIndex = day => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
  const dayValid = day => typeof day === 'string' && /^\d{4}-\d\d-\d\d$/.test(day) && Number.isFinite(dayIndex(day));
  function empty() { return { version: 1, xp: 0, totalSolved: 0, completedSessions: 0, maxCombo: 0, badges: [], unitFirst: {}, days: [], completionDays: [], applied: [], cutoff: 0 }; }
  let data = empty(), initialized = false, compatible = true, lastMessage = '';
  function validSaved(saved) {
    if (!saved || saved.version !== 1 || !['xp','totalSolved','completedSessions','maxCombo','cutoff'].every(key => safeInt(saved[key]))) return false;
    if (!Array.isArray(saved.badges) || !saved.badges.every(id => BADGES.some(badge => badge.id === id))) return false;
    if (!saved.unitFirst || typeof saved.unitFirst !== 'object' || Array.isArray(saved.unitFirst) || !Object.entries(saved.unitFirst).every(([key, count]) => key in UNITS && safeInt(count))) return false;
    if (![saved.days, saved.completionDays].every(days => Array.isArray(days) && days.length <= RULES.journalLimit && days.every(dayValid))) return false;
    return Array.isArray(saved.applied) && saved.applied.length <= RULES.journalLimit && saved.applied.every(item => item && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 160 && safeInt(item.time));
  }
  function initialize() {
    if (initialized) return;
    initialized = true;
    try {
      const raw = root.localStorage && root.localStorage.getItem(KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!validSaved(saved)) throw new Error('Unrecognized rewards data');
      data = saved;
    } catch (_) {
      compatible = false;
      lastMessage = '저장된 성장 기록을 읽을 수 없어 현재 창에만 보관해요. 기존 데이터는 그대로 두었어요.';
    }
  }
  function persist() {
    if (!compatible) return { ok: false, message: lastMessage };
    try {
      if (!root.localStorage) throw new Error('Storage unavailable');
      root.localStorage.setItem(KEY, JSON.stringify(data));
      lastMessage = '';
      return { ok: true, message: '성장 기록을 이 기기에 저장했어요.' };
    } catch (_) {
      lastMessage = '성장 기록은 현재 창에만 보관해요. 기기 저장을 사용할 수 없어 창을 닫으면 사라질 수 있어요.';
      return { ok: false, message: lastMessage };
    }
  }
  function currentStreak(days) {
    const sorted = [...new Set(days)].sort().reverse();
    if (!sorted.length) return 0;
    const today = dayIndex(dayOf(Date.now()));
    const mostRecent = dayIndex(sorted[0]);
    if (mostRecent < today - 1 || mostRecent > today) return 0;
    let count = 1;
    for (let i = 1; i < sorted.length && dayIndex(sorted[i - 1]) - dayIndex(sorted[i]) === 1; i++) count++;
    return count;
  }
  function longestStreak(days) {
    const sorted = [...new Set(days)].sort();
    let best = 0, run = 0, previous = null;
    for (const day of sorted) { const current = dayIndex(day); run = previous !== null && current - previous === 1 ? run + 1 : 1; best = Math.max(best, run); previous = current; }
    return best;
  }
  function profile() {
    initialize();
    return { xp: data.xp, level: Math.floor(data.xp / RULES.xpPerLevel) + 1, levelXp: data.xp % RULES.xpPerLevel, nextLevelXp: RULES.xpPerLevel, totalSolved: data.totalSolved, completedSessions: data.completedSessions, streak: currentStreak(data.days), badges: copy(BADGES.filter(badge => data.badges.includes(badge.id))), maxCombo: data.maxCombo };
  }
  function applySession(record) {
    initialize();
    const unchanged = (message, alreadyApplied = false, ok = true) => ({ ok, message, expEarned: 0, newBadges: [], profile: profile(), alreadyApplied });
    if (record && record.gamificationEnabled === false) return unchanged('성장 보상을 사용하지 않은 학습이에요.');
    if (!validRecord(record)) return unchanged('학습 정보가 올바르지 않아 성장 기록에 반영하지 못했어요.', false, false);
    const time = Date.parse(record.date);
    if (data.applied.some(item => item.id === record.id) || time <= data.cutoff) return unchanged('이미 반영한 학습이에요.', true);
    const day = dayOf(record.date);
    const learned = record.correct > 0 || Array.isArray(record.attempts) && record.attempts.some(item => item && Array.isArray(item.attempts) && item.attempts.length > 0);
    const completed = record.completed === true && learned;
    const firstDailyCompletion = completed && !data.completionDays.includes(day);
    const challenge = record.settings.difficulty === 'challenge';
    const expEarned = record.correct * RULES.xpPerCorrect + (completed ? RULES.completionXp : 0) + (challenge ? record.correct * RULES.challengeXpPerCorrect : 0) + (firstDailyCompletion ? RULES.dailyCompletionXp : 0);
    data.xp = add(data.xp, expEarned);
    data.totalSolved = add(data.totalSolved, record.correct);
    if (completed) data.completedSessions = add(data.completedSessions, 1);
    data.maxCombo = Math.max(data.maxCombo, safeInt(record.comboMax, record.correct) ? record.comboMax : 0);
    const unit = record.settings.unit;
    if (Object.prototype.hasOwnProperty.call(UNITS, unit)) data.unitFirst[unit] = add(data.unitFirst[unit] || 0, record.firstCorrect);
    if (learned) data.days = [...new Set([...data.days, day])].sort().slice(-RULES.journalLimit);
    if (completed) data.completionDays = [...new Set([...data.completionDays, day])].sort().slice(-RULES.journalLimit);
    const earned = new Set(data.badges);
    if (data.completedSessions >= 1) earned.add('first-session');
    if (data.maxCombo >= 10) earned.add('combo-10');
    if (data.totalSolved >= 100) earned.add('solved-100');
    if (longestStreak(data.days) >= 7) earned.add('streak-7');
    for (const [unitId, count] of Object.entries(data.unitFirst)) if (count >= 20) earned.add(`mastery-${unitId}`);
    const newBadges = BADGES.filter(badge => earned.has(badge.id) && !data.badges.includes(badge.id));
    data.badges = [...earned];
    data.applied.push({ id: record.id, time });
    if (data.applied.length > RULES.journalLimit) {
      data.applied.sort((a, b) => b.time - a.time);
      const removed = data.applied.splice(RULES.journalLimit);
      // Never award a replay older than the bounded 5,000-session journal.
      // Very old, previously unrecorded sessions also receive no retroactive XP.
      data.cutoff = Math.max(data.cutoff, ...removed.map(item => item.time));
    }
    const saved = persist();
    return { ...saved, expEarned, newBadges: copy(newBadges), profile: profile(), alreadyApplied: false };
  }
  const api = Object.freeze({ RULES, TYPE_POINTS, baseScore, maxAnswerScore, scoreAnswer, classContribution, profile, applySession, key: KEY });
  root.LearningGame = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
