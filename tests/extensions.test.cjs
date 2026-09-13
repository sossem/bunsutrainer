const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plain = value => JSON.parse(JSON.stringify(value));
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}
function moduleAt(name, context = {}) {
  const sandbox = vm.createContext({ setTimeout, clearTimeout, setInterval, clearInterval, ...context });
  vm.runInContext(fs.readFileSync(path.join(__dirname, `../js/${name}.js`), 'utf8'), sandbox);
  return sandbox;
}
const session = (changes = {}) => ({
  id: 'session-1', date: '2026-09-13T03:00:00.000Z', total: 10, correct: 8,
  firstCorrect: 6, completed: true, gamificationEnabled: true,
  settings: { difficulty: 'normal', unit: 'g5-addsub' }, ...changes
});
const classroom = { schoolName: '배움초등학교', region: '서울 중구', grade: 5, className: '2' };
const rankedSession = (changes = {}) => session({
  rankingEnabled: true, rankingMode: 'online', classroom, classScoreContribution: 52, ...changes
});

test('Loading optional modules does not fetch schools or load Firebase', () => {
  let calls = 0;
  const sandbox = moduleAt('ranking', {
    fetch() { calls++; throw new Error('unexpected request'); },
    document: { head: { appendChild() { calls++; } } }, localStorage: storage()
  });
  assert.equal(typeof sandbox.ClassRanking.updateClassScore, 'function');
  assert.equal(calls, 0);
});

test('Score bonuses require the first unassisted answer; wrong/revealed answers reset combo', () => {
  const game = moduleAt('gamification').LearningGame;
  const answer = { correct: true, firstAttempt: true, difficulty: 'challenge', combo: 4,
    timerEnabled: true, remainingRatio: 0.5 };
  assert.deepEqual(plain(game.scoreAnswer(answer)), { score: 20, combo: 5, bonus: 10 });
  for (const changed of [{ hintUsed: true }, { timedOut: true }, { firstAttempt: false }]) {
    assert.deepEqual(plain(game.scoreAnswer({ ...answer, ...changed })), { score: 13, combo: 0, bonus: 3 });
  }
  for (const changed of [{ correct: false }, { revealed: true }]) {
    assert.deepEqual(plain(game.scoreAnswer({ ...answer, ...changed })), { score: 0, combo: 0, bonus: 0 });
  }
  assert.equal(game.scoreAnswer({ ...answer, remainingRatio: 0.499 }).score, 18);
  assert.equal(game.scoreAnswer({ ...answer, timerEnabled: false }).score, 18);
});

test('Class contribution is independent of game score, difficulty and timer bonuses', () => {
  const game = moduleAt('gamification').LearningGame;
  assert.equal(game.classContribution(session()), 52);
  assert.equal(game.classContribution(session({ score: 9999, timerEnabled: true })), 52);
  assert.equal(game.classContribution(session({ total: 5, firstCorrect: 5 })), 55);
  assert.equal(game.classContribution(session({ firstCorrect: 0 })), 10);
  for (const changes of [{ completed: false }, { total: 4, firstCorrect: 4 }, { firstCorrect: 11 }]) {
    assert.equal(game.classContribution(session(changes)), 0);
  }
});

test('XP, daily bonus, levels and completion badges survive reload without duplicate awards', () => {
  const local = storage(), game = moduleAt('gamification', { localStorage: local }).LearningGame;
  const first = game.applySession(session());
  assert.equal(first.ok, true);
  assert.equal(first.expEarned, 65);
  assert.deepEqual(plain(first.newBadges).map(badge => badge.id), ['first-session']);
  assert.equal(game.applySession(session()).expEarned, 0);
  const reloaded = moduleAt('gamification', { localStorage: local }).LearningGame;
  assert.equal(reloaded.applySession(session()).alreadyApplied, true);
  assert.equal(reloaded.applySession(session({ id: 'second' })).expEarned, 60);
  assert.equal(reloaded.profile().xp, 125);
  assert.equal(reloaded.profile().level, 2);
  assert.equal(reloaded.profile().levelXp, 25);
  assert.equal(reloaded.applySession(session({ id: 'third', date: '2026-09-13T15:00:00Z' })).expEarned, 65,
    'The first completion after midnight in Korea earns the next daily bonus');
});

test('Challenge XP and mastery/combo badges are earned once; disabled and empty sessions earn nothing', () => {
  const game = moduleAt('gamification', { localStorage: storage() }).LearningGame;
  assert.equal(game.applySession(session({ gamificationEnabled: false })).expEarned, 0);
  assert.equal(game.applySession(session({ id: 'empty', correct: 0, firstCorrect: 0 })).expEarned, 0);
  const first = game.applySession(session({ total: 20, correct: 20, firstCorrect: 20, comboMax: 10,
    settings: { difficulty: 'challenge', unit: 'g5-addsub' } }));
  assert.equal(first.expEarned, 165);
  assert.deepEqual(plain(first.newBadges).map(badge => badge.id), ['first-session', 'combo-10', 'mastery-g5-addsub']);
  assert.equal(game.applySession(session({ id: 'later', total: 20, correct: 20, firstCorrect: 20, comboMax: 10 })).newBadges.length, 0);
});

test('Unsupported rewards data is preserved and failed persistence retains the in-memory award', () => {
  const raw = '{"version":99,"xp":1234}', local = storage({ 'bunsu.game.v1': raw });
  const game = moduleAt('gamification', { localStorage: local }).LearningGame;
  assert.equal(game.applySession(session()).ok, false);
  assert.equal(local.getItem(game.key), raw);
  assert.equal(game.profile().xp, 65);
  assert.equal(game.applySession(session()).alreadyApplied, true);
  const denied = moduleAt('gamification', { localStorage: {
    getItem() { return null; }, setItem() { throw new Error('quota'); }
  } }).LearningGame;
  assert.equal(denied.applySession(session()).ok, false);
  assert.equal(denied.profile().xp, 65);
});

function fakeTimer(seconds, callbacks = {}) {
  let time = 0, nextId = 0;
  const scheduled = new Map(), cancelled = [];
  const api = moduleAt('timer').StudyTimer;
  const timer = api.create({ seconds, now: () => time,
    setInterval(callback) { scheduled.set(++nextId, callback); return nextId; },
    clearInterval(id) { cancelled.push(scheduled.get(id)); scheduled.delete(id); }, ...callbacks });
  return { timer, advance(ms) { time += ms; for (const callback of [...scheduled.values()]) callback(); },
    setTime(value) { time = value; }, staleTick() { for (const callback of cancelled) callback(); },
    scheduled: () => scheduled.size };
}

test('Timer measures elapsed time, pauses exactly and expires once despite delayed/stale callbacks', () => {
  let expirations = 0;
  const clock = fakeTimer(10, { onExpire() { expirations++; } });
  clock.timer.start();
  clock.advance(2400);
  assert.equal(clock.timer.snapshot().remaining, 8);
  assert.equal(clock.timer.snapshot().elapsedSeconds, 2.4);
  clock.timer.pause();
  clock.advance(60000);
  assert.equal(clock.timer.snapshot().remaining, 8);
  clock.timer.start();
  clock.advance(8000);
  assert.equal(clock.timer.snapshot().remaining, 0);
  assert.equal(clock.timer.snapshot().expired, true);
  assert.equal(expirations, 1);
  clock.staleTick(); clock.timer.pause(); clock.timer.start();
  assert.equal(expirations, 1);
  assert.equal(clock.scheduled(), 0);
});

test('Timer reset and destroy invalidate callbacks; disabled timer schedules no work', () => {
  let expirations = 0;
  const clock = fakeTimer(1, { onExpire() { expirations++; } });
  clock.timer.start(); clock.timer.reset(20); clock.timer.start(); clock.staleTick();
  assert.equal(clock.timer.snapshot().remaining, 20);
  clock.timer.destroy(); clock.advance(30000); clock.staleTick();
  assert.equal(expirations, 0);
  assert.equal(clock.scheduled(), 0);
  assert.equal(clock.timer.start().running, false);
  const disabled = fakeTimer(0);
  assert.equal(disabled.timer.start().enabled, false);
  assert.equal(disabled.scheduled(), 0);
});

test('A pause at the deadline reports expiry once and a reentrant reset suppresses stale expiry', () => {
  let expirations = 0;
  const clock = fakeTimer(1, { onExpire() { expirations++; } });
  clock.timer.start(); clock.setTime(1000); clock.timer.pause();
  assert.equal(expirations, 1);
  clock.staleTick();
  assert.equal(expirations, 1);
  let resetClock;
  resetClock = fakeTimer(1, { onTick(value) { if (value.expired) resetClock.timer.reset(30); },
    onExpire() { assert.fail('The reset question must not receive the old expiration'); } });
  resetClock.timer.start(); resetClock.advance(2000);
  assert.equal(resetClock.timer.snapshot().remaining, 30);
});

test('Timer settings validate whole seconds including both supported boundaries', () => {
  for (const value of [-1, 3601, 1.5, NaN, '10']) assert.throws(() => fakeTimer(value), { name: 'RangeError' });
  assert.equal(fakeTimer(3600).timer.snapshot().remaining, 3600);
});

test('Ranking uses Korean Monday boundaries and canonical valid class selections', () => {
  const ranking = moduleAt('ranking', { localStorage: storage() }).ClassRanking;
  assert.deepEqual(plain(ranking.getWeekIds('2026-09-13T14:59:59Z')), { current: '20260907', prev: '20260831' });
  assert.deepEqual(plain(ranking.getWeekIds('2026-09-13T15:00:00Z')), { current: '20260914', prev: '20260907' });
  assert.equal(ranking.selectClass({ ...classroom, className: '02' }).ok, true);
  assert.equal(ranking.getSelection().id, '[서울 중구] 배움초등학교 5학년 2반');
  for (const changed of [{ grade: 3 }, { grade: 7 }, { className: '31' }, { schoolName: 'bad/path' }]) {
    assert.equal(ranking.selectClass({ ...classroom, ...changed }).ok, false);
  }
  ranking.clearSelection();
  assert.equal(ranking.getSelection(), null);
});

test('Demo contributions persist once and cannot be sent online', async () => {
  const local = storage(); let networkCalls = 0;
  const ranking = moduleAt('ranking').ClassRanking.createRepository({ storage: local,
    clock: () => new Date('2026-09-13T03:00:00Z'), onlineProvider() { networkCalls++; throw new Error('no network'); } });
  ranking.selectClass(classroom);
  const record = rankedSession({ rankingMode: 'demo' });
  assert.equal((await ranking.updateClassScore(record, { mode: 'demo' })).contribution, 52);
  assert.equal((await ranking.updateClassScore(record, { mode: 'demo' })).duplicate, true);
  const data = await ranking.getRankingData({ mode: 'demo' });
  assert.equal(data.ourClass.score, 52);
  assert.equal(data.ourClass.sessions, 1);
  assert.equal(data.totalClasses, 6);
  assert.equal(data.ourRank, 6);
  assert.equal((await ranking.updateClassScore(record)).ok, false);
  assert.equal((await ranking.updateClassScore({ ...record, rankingMode: 'online' })).ok, false);
  assert.equal(networkCalls, 0);
  const reloaded = moduleAt('ranking').ClassRanking.createRepository({ storage: local, clock: () => new Date(record.date) });
  assert.equal((await reloaded.getRankingData({ mode: 'demo' })).ourClass.score, 52);
});

test('Online ranking preserves separate legacy collections, sorts ties and does not invent ranks outside the top list', async () => {
  const requests = [], ownId = '[서울 중구] 배움초등학교 5학년 2반';
  const ranking = moduleAt('ranking').ClassRanking.createRepository({ storage: storage(),
    clock: () => new Date('2026-09-13T03:00:00Z'), onlineProvider: {
      async read(request) { requests.push(request); return {
        rows: [{ id: 'b', schoolName: '[부산 중구] 나래초등학교', score: 10 },
          { id: 'a', schoolName: '새봄초등학교', score: 10 }],
        ourClass: { ...classroom, id: ownId, score: 1 }
      }; }
    } });
  ranking.selectClass(classroom);
  const online = await ranking.getRankingData();
  assert.deepEqual(plain(online.rows).map(row => row.id), ['a', 'b']);
  assert.equal(online.ourClass.id, ownId);
  assert.equal(online.ourRank, null);
  assert.equal(online.totalClasses, null);
  const legacy = await ranking.getRankingData({ mode: 'legacy', week: 'prev' });
  assert.equal(legacy.rows[1].schoolName, '나래초등학교');
  assert.equal(legacy.rows[1].region, '부산 중구');
  assert.equal(requests[0].collection, 'classGrowthRankings_20260907');
  assert.equal(requests[1].collection, 'classRankings_20260831');
});

test('Online failures remain failures; explicit opt-in and completed records are required before any provider call', async () => {
  let calls = 0;
  const ranking = moduleAt('ranking').ClassRanking.createRepository({ storage: storage(),
    onlineProvider() { calls++; throw new Error('permission denied'); } });
  for (const changes of [{ rankingEnabled: false }, { completed: false }, { total: 4 }, { classroom: null }]) {
    assert.equal((await ranking.updateClassScore(rankedSession(changes))).ok, false);
  }
  assert.equal(calls, 0);
  const response = await ranking.getRankingData();
  assert.equal(response.ok, false);
  assert.equal(response.mode, 'online');
  assert.equal(response.rows.length, 0);
  assert.equal((await ranking.updateClassScore(rankedSession())).ok, false);
  assert.equal(calls, 2);
});

test('Mock Firestore transactions read before writing and receipts make a retry idempotent', async () => {
  const documents = new Map(), operations = [];
  const db = { collection: name => ({ doc: id => `${name}/${id}` }),
    async runTransaction(run) {
      let hasWritten = false;
      return run({
        async get(ref) {
          assert.equal(hasWritten, false, 'Firestore transactions require all reads before writes');
          operations.push(['get', ref]);
          return { exists: documents.has(ref), data: () => documents.get(ref) };
        },
        set(ref, value) { hasWritten = true; operations.push(['set', ref]); documents.set(ref, plain(value)); }
      });
    }
  };
  const api = moduleAt('ranking').ClassRanking;
  const ranking = api.createRepository({ storage: storage(), onlineProvider: api.createFirestoreProvider(db) });
  const record = rankedSession();
  assert.equal((await ranking.updateClassScore(record)).contribution, 52);
  assert.equal((await ranking.updateClassScore(record)).duplicate, true);
  const row = documents.get('classGrowthRankings_20260907/[서울 중구] 배움초등학교 5학년 2반');
  assert.equal(row.score, 52);
  assert.equal(row.totalSolved, 10);
  assert.equal(row.correctCount, 6);
  assert.equal(row.sessions, 1);
  assert.deepEqual(operations.map(op => op[0]), ['get', 'get', 'set', 'set', 'get']);
});

test('School lookup uses the bundled dataset once and reports fetch failures without imaginary results', async () => {
  let calls = 0;
  const api = moduleAt('ranking').ClassRanking;
  const ranking = api.createRepository({ storage: storage(), fetch: async url => {
    calls++;
    assert.equal(url, 'elementaryschooldata.json');
    return { ok: true, json: async () => [{ 학교명: '배움초등학교', 시도명: '서울특별시', 도로명주소: '서울특별시 중구 배움길 1' }] };
  } });
  assert.equal((await ranking.searchSchools('')).length, 0);
  const result = await ranking.searchSchools('배움');
  assert.equal(result[0].region, '서울특별시 중구');
  assert.equal((await ranking.searchSchools('서울')).length, 1);
  assert.equal(calls, 1);
  const offline = api.createRepository({ fetch: async () => { throw new Error('offline'); } });
  await assert.rejects(() => offline.searchSchools('배움'), /학교 검색을 사용할 수 없어요/);
});
