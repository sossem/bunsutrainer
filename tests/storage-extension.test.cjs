const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/storage.js'), 'utf8');
const KEY = 'bunsu.learning.v1';
const plain = (value) => JSON.parse(JSON.stringify(value));

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  let writes = 0;
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); writes++; },
    removeItem: (key) => { values.delete(key); },
    writes: () => writes
  };
}
function adapter(localStorage) {
  const context = vm.createContext({ localStorage });
  vm.runInContext(source, context);
  return context.LearningStorage;
}
function legacyRecord(id = 'legacy') {
  return {
    id, date: '2026-09-12T10:20:30.000Z', settings: { mode: 'personal', grade: 5, unit: 'g5-add-sub', count: 10 },
    total: 10, correct: 8, firstCorrect: 6, durationSeconds: 90,
    wrongProblems: [{ id: 'problem-a', kind: 'calculation', answer: { n: 1, d: 2 } }],
    attempts: [{ correct: false, input: { num: '2', den: '9' }, feedback: 'add-denominators' }]
  };
}
function extension() {
  return {
    score: 1250, comboMax: 5, expEarned: 125, badgesEarned: ['first-session', 'combo-5'],
    timerEnabled: true, timerSeconds: 60, timeoutCount: 1, averageSolveSeconds: 9.25,
    completed: true, gamificationEnabled: true, rankingEnabled: true, rankingMode: 'online',
    classScoreContribution: 250, classContributionStatus: 'synced',
    classroom: { id: 'school-a:5:2', schoolName: '배움초등학교', region: '서울', grade: 5, className: '2반' },
    gameVersion: 1
  };
}

test('New scoring version and large totals survive reload without changing old scores', () => {
  const old = {...legacyRecord(), ...extension(), score:71};
  const local = storage({[KEY]:JSON.stringify({version:1,records:[old]})});
  const store = adapter(local);
  assert.equal(store.save({...legacyRecord('new-score'), ...extension(), scoringVersion:2, score:41000, classScoreContribution:41000}).ok,true);
  const records = plain(adapter(local).list());
  assert.equal(records[0].scoringVersion,2);
  assert.equal(records[0].score,41000);
  assert.equal(records[0].classScoreContribution,41000);
  assert.deepEqual(records[1],old);
});

test('Legacy version-1 records survive reading, adding extended records and reloading unchanged', () => {
  const original = legacyRecord();
  const encoded = JSON.stringify({ version: 1, records: [original] });
  const local = storage({ [KEY]: encoded }), store = adapter(local);
  assert.equal(store.key, KEY);
  assert.deepEqual(plain(store.list()), [original]);
  assert.equal(local.getItem(KEY), encoded);
  assert.equal(local.writes(), 0, 'Reading history must not rewrite persistent records');
  assert.equal(store.save({ ...legacyRecord('new'), ...extension() }).ok, true);
  const envelope = JSON.parse(local.getItem(KEY));
  assert.equal(envelope.version, 1);
  const history = adapter(local).list();
  assert.deepEqual(plain(history.find((record) => record.id === 'legacy')), original);
  for (const key of Object.keys(extension())) assert.equal(Object.hasOwn(history[1], key), false, key);
});

test('Weekly nickname identity round-trips without changing legacy history or keys', () => {
  const original = legacyRecord();
  const local = storage({ [KEY]: JSON.stringify({ version: 1, records: [original] }) });
  const classroom = { id: '[서울 중구] 배움초등학교 5학년 2반', schoolName: '배움초등학교', region: '서울 중구', grade: 5, className: '2' };
  const competition = { weekId: '20260914', nickname: '공부하는고양이', playerId: `${classroom.id}::공부하는고양이`, classroom };
  const store = adapter(local);
  assert.equal(store.save({ ...legacyRecord('weekly'), ...extension(), competition }).ok, true);
  const reloaded = adapter(local).list();
  assert.deepEqual(plain(reloaded.find(r => r.id === 'weekly').competition), competition);
  assert.deepEqual(plain(reloaded.find(r => r.id === 'legacy')), original);
  assert.equal(JSON.parse(local.getItem(KEY)).version, 1);
  for (const invalid of [null, {}, { ...competition, weekId: 'old' }, { ...competition, classroom: { ...classroom, grade: 7 } }]) {
    assert.equal(store.save({ ...legacyRecord('invalid-identity'), competition: invalid }).ok, true);
    assert.equal(Object.hasOwn(store.list().find(r => r.id === 'invalid-identity'), 'competition'), false);
  }
});

test('Every extension field and nested per-question metadata round-trips without external modules', () => {
  const local = storage(), store = adapter(local);
  const record = {
    ...legacyRecord('extended'), ...extension(),
    attempts: [{ id: 'q1', elapsedSeconds: 12.5, timeLimitSeconds: 60, timedOut: false,
      hintUsed: true, score: 75, attempts: [{ value: { n: 1, d: 2 }, correct: true, elapsedSeconds: 12.5 }] }]
  };
  assert.equal(store.save(record).ok, true);
  assert.deepEqual(plain(adapter(local).list()[0]), record);
  record.classroom.schoolName = 'changed input';
  record.attempts[0].attempts[0].value.n = 9;
  const history = store.list();
  assert.equal(history[0].classroom.schoolName, '배움초등학교');
  assert.equal(history[0].attempts[0].attempts[0].value.n, 1);
  history[0].badgesEarned.push('changed-output');
  assert.equal(store.list()[0].badgesEarned.length, 2);
});

test('False flags and zero values persist explicitly while old records remain absent', () => {
  const store = adapter(storage());
  const neutral = {
    score: 0, comboMax: 0, expEarned: 0, badgesEarned: [], timerEnabled: false,
    timerSeconds: 0, timeoutCount: 0, averageSolveSeconds: 0, completed: false,
    gamificationEnabled: false, rankingEnabled: false, rankingMode: 'demo',
    classScoreContribution: 0, classContributionStatus: 'not-joined', gameVersion: 1
  };
  const record = { ...legacyRecord(), ...neutral };
  assert.equal(store.save(record).ok, true);
  assert.deepEqual(plain(store.list()[0]), record);
});

test('Corrupt optional values are omitted without rejecting valid learning history', () => {
  const store = adapter(storage());
  const broken = {
    score: -1, comboMax: 1.5, expEarned: Infinity, badgesEarned: 'badges',
    timerEnabled: 'true', timerSeconds: 3601, timeoutCount: 11, averageSolveSeconds: NaN,
    completed: 1, gamificationEnabled: null, rankingEnabled: [], rankingMode: 'production',
    classScoreContribution: '250', classContributionStatus: 'invented',
    classroom: { id: 'a', schoolName: 'b', region: 'c', grade: 0, className: 'd' }, gameVersion: 2
  };
  const original = legacyRecord();
  assert.equal(store.save({ ...original, ...broken }).ok, true);
  assert.deepEqual(plain(store.list()[0]), original);
});

test('Malformed extension data in persisted records does not suppress otherwise valid records', () => {
  const original = legacyRecord();
  const raw = { ...original, score: 'untrusted', timerSeconds: -1, timeoutCount: -1, classroom: [], badgesEarned: null };
  const local = storage({ [KEY]: JSON.stringify({ version: 1, records: [raw] }) });
  assert.deepEqual(plain(adapter(local).list()), [original]);
  assert.equal(local.writes(), 0);
});

test('Badge IDs are bounded strings, unique and independent of invalid entries', () => {
  const store = adapter(storage());
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(store.save({ ...legacyRecord(), badgesEarned: ['first', 'first', '', ' ', 42, { id: 'object' }, cyclic, 'second'] }).ok, true);
  assert.deepEqual(plain(store.list()[0].badgesEarned), ['first', 'second']);
  assert.equal(store.save({ ...legacyRecord(), badgesEarned: Array.from({ length: 110 }, (_, i) => `badge-${i}`) }).ok, true);
  assert.equal(store.list()[0].badgesEarned.length, 100);
});

test('Classroom snapshots retain only display identifiers and valid primary-grade selections', () => {
  const store = adapter(storage());
  const classroom = { ...extension().classroom, secretToken: 'never-store', studentNames: ['a'] };
  assert.equal(store.save({ ...legacyRecord(), classroom }).ok, true);
  assert.deepEqual(plain(store.list()[0].classroom), extension().classroom);
  for (const invalid of [null, [], {}, { ...classroom, id: '' }, { ...classroom, grade: '5' }, { ...classroom, grade: 7 }, { ...classroom, className: '' }]) {
    assert.equal(store.save({ ...legacyRecord(), classroom: invalid }).ok, true);
    assert.equal(Object.hasOwn(store.list()[0], 'classroom'), false);
  }
});

test('Optional metadata getters cannot discard an otherwise valid record', () => {
  const store = adapter(storage());
  const record = legacyRecord();
  for (const key of ['score', 'classroom', 'badgesEarned']) {
    Object.defineProperty(record, key, { enumerable: true, get() { throw new Error('invalid extension'); } });
  }
  assert.equal(store.save(record).ok, true);
  assert.deepEqual(plain(store.list()[0]), legacyRecord());
});

test('Score and class contribution are independent of correctness and opt-in flags', () => {
  const store = adapter(storage());
  const record = { ...legacyRecord(), correct: 0, firstCorrect: 0, score: 1000, expEarned: 25,
    comboMax: 0, rankingEnabled: false, gamificationEnabled: false,
    classScoreContribution: 9000, classContributionStatus: 'pending' };
  assert.equal(store.save(record).ok, true);
  assert.deepEqual(plain(store.list()[0]), record);
  assert.equal(store.save({ ...record, classContributionStatus: 'synced' }).ok, true);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].classScoreContribution, 9000);
  assert.equal(store.list()[0].classContributionStatus, 'synced');
});

test('Domain boundaries accept timer 3600 and timeout total; reject unsafe scores and new unknown fields', () => {
  const store = adapter(storage());
  assert.equal(store.save({ ...legacyRecord(), timerSeconds: 3600, timeoutCount: 10, score: Number.MAX_SAFE_INTEGER }).ok, true);
  assert.equal(store.list()[0].timerSeconds, 3600);
  assert.equal(store.list()[0].timeoutCount, 10);
  assert.equal(store.list()[0].score, Number.MAX_SAFE_INTEGER);
  assert.equal(store.save({ ...legacyRecord(), score: Number.MAX_SAFE_INTEGER + 1, debugSecret: 'ignored' }).ok, true);
  assert.equal(Object.hasOwn(store.list()[0], 'score'), false);
  assert.equal(Object.hasOwn(store.list()[0], 'debugSecret'), false);
});

test('Denied or full storage keeps complete extensions in memory and reports the limitation', () => {
  const blocked = [undefined, { getItem() { throw new Error('denied'); } },
    { getItem() { return null; }, setItem() { throw new Error('quota'); }, removeItem() {} }];
  for (const local of blocked) {
    const store = adapter(local), record = { ...legacyRecord(), ...extension() };
    assert.equal(store.available(), false);
    assert.equal(store.save(record).ok, false);
    assert.deepEqual(plain(store.list()), [record]);
    assert.equal(store.save({ ...record, classContributionStatus: 'failed' }).ok, false);
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].classContributionStatus, 'failed');
  }
});
