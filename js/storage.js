/* Replace this adapter to connect a server; views only use this small API. */
(function (root) {
  'use strict';
  const KEY = 'bunsu.learning.v1';
  const VERSION = 1;
  const LIMIT = 100;
  let records = [];
  let loaded = false;
  let compatible = true;
  let lastMessage = '';

  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function validCount(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 200; }
  function nonnegative(value) { return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER; }
  function shortText(value, max = 160) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
  function optionalFields(record) {
    // Version 1 remains readable without game or ranking modules. Missing fields
    // remain missing so old learning records never acquire invented game scores.
    const extra = {};
    const validators = {
      score: nonnegative,
      comboMax: (value) => Number.isSafeInteger(value) && value >= 0,
      expEarned: nonnegative,
      timerEnabled: (value) => typeof value === 'boolean',
      timerSeconds: (value) => Number.isFinite(value) && value >= 0 && value <= 3600,
      timeoutCount: (value) => Number.isSafeInteger(value) && value >= 0 && value <= record.total,
      averageSolveSeconds: nonnegative,
      completed: (value) => typeof value === 'boolean',
      gamificationEnabled: (value) => typeof value === 'boolean',
      rankingEnabled: (value) => typeof value === 'boolean',
      rankingMode: (value) => ['online', 'demo'].includes(value),
      classScoreContribution: nonnegative,
      classContributionStatus: (value) => ['pending', 'synced', 'failed', 'demo', 'not-joined'].includes(value),
      gameVersion: (value) => value === 1,
      scoringVersion: (value) => value === 2
    };
    for (const [key, validate] of Object.entries(validators)) {
      try {
        const field = Object.getOwnPropertyDescriptor(record, key);
        if (field && 'value' in field && validate(field.value)) extra[key] = field.value;
      } catch (_) { /* A damaged optional field must not discard a learning record. */ }
    }
    try {
      const field = Object.getOwnPropertyDescriptor(record, 'badgesEarned');
      if (field && Array.isArray(field.value)) {
        extra.badgesEarned = [...new Set(field.value.filter((id) => shortText(id)))].slice(0, 100);
      }
    } catch (_) { /* Optional metadata is independently recoverable. */ }
    try {
      const field = Object.getOwnPropertyDescriptor(record, 'classroom');
      const classroom = field && field.value;
      if (classroom && typeof classroom === 'object' && !Array.isArray(classroom)
          && shortText(classroom.id) && shortText(classroom.schoolName, 200)
          && typeof classroom.region === 'string' && classroom.region.length <= 100
          && Number.isInteger(classroom.grade) && classroom.grade >= 4 && classroom.grade <= 6
          && shortText(classroom.className, 100)) {
        extra.classroom = {
          id: classroom.id, schoolName: classroom.schoolName, region: classroom.region,
          grade: classroom.grade, className: classroom.className
        };
      }
    } catch (_) { /* Keep ordinary history even if the classroom snapshot is invalid. */ }
    try {
      const field = Object.getOwnPropertyDescriptor(record, 'competition');
      const identity = field && field.value;
      const classroom = identity && identity.classroom;
      if (identity && typeof identity === 'object' && !Array.isArray(identity)
          && /^\d{8}$/.test(identity.weekId) && shortText(identity.playerId, 240)
          && shortText(identity.nickname, 40) && classroom && typeof classroom === 'object'
          && shortText(classroom.id, 220) && shortText(classroom.schoolName, 100)
          && shortText(classroom.region, 80) && Number.isInteger(classroom.grade)
          && classroom.grade >= 4 && classroom.grade <= 6
          && /^(?:[1-9]|[12]\d|30)$/.test(classroom.className)) {
        extra.competition = { weekId: identity.weekId, playerId: identity.playerId, nickname: identity.nickname,
          classroom: { id: classroom.id, schoolName: classroom.schoolName, region: classroom.region,
            grade: classroom.grade, className: classroom.className } };
      }
    } catch (_) { /* New weekly identity fields do not affect older study records. */ }
    return extra;
  }
  function normalize(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    if (typeof record.id !== 'string' || !record.id || record.id.length > 160) return null;
    if (typeof record.date !== 'string' || !Number.isFinite(Date.parse(record.date))) return null;
    if (!validCount(record.total) || !validCount(record.correct) || record.correct > record.total) return null;
    const firstCorrect = record.firstCorrect === undefined ? record.correct : record.firstCorrect;
    if (!validCount(firstCorrect) || firstCorrect > record.correct) return null;
    if (!Number.isFinite(record.durationSeconds) || record.durationSeconds < 0) return null;
    if (!record.settings || typeof record.settings !== 'object' || Array.isArray(record.settings)) return null;
    try {
      const clean = copy({
        id: record.id,
        date: new Date(record.date).toISOString(),
        settings: record.settings,
        total: record.total,
        correct: record.correct,
        firstCorrect,
        durationSeconds: Math.round(record.durationSeconds),
        wrongProblems: Array.isArray(record.wrongProblems) ? record.wrongProblems.slice(0, 200) : [],
        attempts: Array.isArray(record.attempts) ? record.attempts.slice(0, 1000) : [],
        ...optionalFields(record)
      });
      if (JSON.stringify(clean).length > 1500000) return null;
      return clean;
    } catch (_) { return null; }
  }
  function initialize() {
    if (loaded) return;
    loaded = true;
    try {
      const stored = root.localStorage && root.localStorage.getItem(KEY);
      if (!stored) return;
      const data = JSON.parse(stored);
      if (!data || data.version !== VERSION || !Array.isArray(data.records)) {
        compatible = false;
        lastMessage = '저장된 기록의 형식을 읽을 수 없어 이번 기록은 현재 창에만 보관해요.';
        return;
      }
      const ids = new Set();
      records = data.records.map(normalize).filter((record) => {
        if (!record || ids.has(record.id)) return false;
        ids.add(record.id);
        return true;
      }).slice(0, LIMIT);
    } catch (_) {
      // Keep unrecognized data intact until the user explicitly clears history.
      compatible = false;
      lastMessage = '기록을 불러올 수 없어 이번 기록은 현재 창에만 보관해요.';
    }
  }
  function list() { initialize(); return copy(records); }
  function persist() {
    if (!compatible) return { ok: false, message: lastMessage };
    try {
      if (!root.localStorage) throw new Error('Storage unavailable');
      root.localStorage.setItem(KEY, JSON.stringify({ version: VERSION, records }));
      lastMessage = '';
      return { ok: true, message: '학습 기록을 이 기기에 저장했어요.' };
    } catch (_) {
      lastMessage = '기기 저장 공간을 사용할 수 없어 기록은 현재 창에만 보관해요. 창을 닫으면 사라질 수 있어요.';
      return { ok: false, message: lastMessage };
    }
  }
  function save(record) {
    initialize();
    const clean = normalize(record);
    if (!clean) return { ok: false, message: '학습 기록의 형식이 올바르지 않아 저장하지 못했어요.' };
    records = [clean, ...records.filter((item) => item.id !== clean.id)].slice(0, LIMIT);
    return persist();
  }
  function clear() {
    initialize();
    records = [];
    try {
      if (!root.localStorage) throw new Error('Storage unavailable');
      root.localStorage.removeItem(KEY);
      compatible = true;
      lastMessage = '';
      return { ok: true, message: '이 기기의 학습 기록을 지웠어요.' };
    } catch (_) {
      lastMessage = '현재 창의 기록은 지웠지만, 기기에 저장된 기록은 지우지 못했어요.';
      return { ok: false, message: lastMessage };
    }
  }
  function available() {
    initialize();
    if (!compatible) return false;
    try {
      if (!root.localStorage) return false;
      const probe = `${KEY}.probe`;
      root.localStorage.setItem(probe, '1');
      root.localStorage.removeItem(probe);
      return true;
    } catch (_) { return false; }
  }
  const api = Object.freeze({ list, save, clear, available, key: KEY, limit: LIMIT });
  root.LearningStorage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
