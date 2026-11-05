const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, `../js/${name}.js`), 'utf8');
function fixture({ mode = 'personal', elapsedSeconds = 0, autoReveal = false, record = null } = {}) {
  const state = {
    view: 'session', mode,
    session: {
      mode, index: 0, combo: 0, comboMax: 0, score: 0, questionStartedAt: 0,
      settings: { timerSeconds: 10, autoReveal, gamificationEnabled: true, difficulty: 'normal' },
      responses: [{ correct: false, firstCorrect: false, revealed: false, attempts: [] }],
      reveals: [{ panel: '', answerShown: false }], timers: []
    }
  };
  const values = new Map(record ? [[record.id, record]] : []);
  let saves = 0, timerCreations = 0, callbacks, resolveContribution, rejectContribution;
  const contribution = new Promise((resolve, reject) => { resolveContribution = resolve; rejectContribution = reject; });
  const snapshot = () => ({ enabled: true, seconds: 10, remaining: Math.ceil(10 - elapsedSeconds),
    elapsedSeconds, running: elapsedSeconds < 10, expired: elapsedSeconds >= 10 });
  const clock = { snapshot, start: snapshot, pause: snapshot, reset: snapshot, destroy: snapshot };
  const context = vm.createContext({
    document: { querySelector() { return null; } }, performance: { now: () => elapsedSeconds * 1000 },
    ClassRanking: { getSelection: () => null, updateClassScore: () => contribution },
    WeeklyCompetition: { getIdentity: () => null, submit: () => contribution },
    StudyTimer: { create(options) { timerCreations++; callbacks = options; return clock; } },
    LearningStorage: {
      save(value) { saves++; values.set(value.id, value); return { ok: true }; },
      list: () => [...values.values()], clear: () => values.clear()
    }
  });
  vm.runInContext(read('gamification'), context);
  vm.runInContext(read('session-extras'), context);
  const extras = context.SessionExtras.create({ state, button: () => '', esc: String, render() {}, notify() {} });
  extras.sync();
  return { extras, state, context, expire: () => callbacks.onExpire(), store: context.LearningStorage,
    saves: () => saves, timerCreations: () => timerCreations, resolveContribution, rejectContribution };
}

test('Classroom expiration reveals an unanswered problem without changing the question', () => {
  const f = fixture({ mode: 'classroom', autoReveal: true });
  f.expire();
  assert.equal(f.state.session.responses[0].timedOut, true);
  assert.equal(f.state.session.reveals[0].panel, 'answer');
  assert.equal(f.state.session.reveals[0].answerShown, true);
  assert.equal(f.state.session.index, 0);
});

test('Classroom expiration preserves a solution or visual after the teacher has revealed the answer', () => {
  for (const panel of ['solution', 'visual']) {
    const f = fixture({ mode: 'classroom', autoReveal: true });
    Object.assign(f.state.session.reveals[0], { panel, answerShown: true });
    f.expire();
    assert.equal(f.state.session.responses[0].timedOut, true);
    assert.equal(f.state.session.reveals[0].panel, panel);
  }
});

test('Non-competition review has no timer or speed bonus even when older settings enable it', () => {
  for (const elapsedSeconds of [4.99, 5, 5.01, 5.99]) {
    const f = fixture({ elapsedSeconds });
    const answer = f.state.session.responses[0];
    Object.assign(answer, { correct: true, firstCorrect: true, attempts: [{ correct: true }] });
    f.extras.submitted(answer, { correct: true, valid: true });
    assert.equal(answer.score, 250, `${elapsedSeconds} seconds elapsed`);
    assert.equal(f.state.session.score, 250);
    assert.equal(f.timerCreations(), 0);
    assert.equal(f.extras.clockHtml(), '');
    assert.equal(f.extras.setupHtml(), '');
  }
});

test('Competition speed bonus decreases with elapsed time, excludes hints, and awards once', () => {
  for (const [seconds, expected] of [[0, 350], [30, 300], [60, 250], [90, 250]]) {
    const f = fixture({ elapsedSeconds: seconds }), s = f.state.session, a = s.responses[0];
    s.competition = { playerId: 'test' };
    Object.assign(a, { correct: true, firstCorrect: true });
    f.extras.submitted(a, { correct: true });
    assert.equal(s.score, expected);
    f.extras.submitted(a, { correct: true });
    assert.equal(s.score, expected);
    assert.equal(f.timerCreations(), 0);
  }
  const f = fixture(), s = f.state.session, a = s.responses[0];
  s.competition = { playerId: 'test' };
  Object.assign(a, { correct: true, firstCorrect: true, hintUsed: true });
  f.extras.submitted(a, { correct: true });
  assert.equal(s.score, 200);
});

test('Award uses selected variety, appears once, and cannot duplicate on repeated submission', () => {
  const f = fixture(), s = f.state.session, a = s.responses[0];
  Object.assign(s.settings, {unit:'g4-addsub',type:'all',difficulty:'challenge'});
  Object.assign(a, {correct:true,firstCorrect:true});
  f.extras.submitted(a, {correct:true});
  assert.equal(s.score,1550);
  assert.match(f.extras.gameHtml(), /score-burst/);
  assert.doesNotMatch(f.extras.gameHtml(), /score-burst/);
  f.extras.submitted(a, {correct:true});
  assert.equal(s.score,1550);
  assert.equal(s.combo,1);
  assert.doesNotMatch(f.extras.gameHtml(), /score-burst/);
});

test('Weekly contributions retain nickname metadata and deleted histories stay deleted', async () => {
  const record = { id: 'weekly', classContributionStatus: 'pending', rankingMode: 'online',
    competition: { weekId: '20260914', playerId: 'student', nickname: '공부하는고양이' } };
  const f = fixture({ record });
  const pending = f.extras.contribute(record);
  f.store.clear();
  f.resolveContribution({ ok: true, message: 'stored' });
  await pending;
  assert.equal(record.classContributionStatus, 'synced');
  assert.equal(record.competition.nickname, '공부하는고양이');
  assert.equal(f.saves(), 0);
});

test('Pending ranking responses do not restore a record deleted while waiting', async () => {
  for (const outcome of ['success', 'failure', 'rejection']) {
    const record = { id: `pending-${outcome}`, classContributionStatus: 'pending', rankingMode: 'online' };
    const f = fixture({ record });
    const request = f.extras.contribute(record);
    f.store.clear();
    if (outcome === 'rejection') f.rejectContribution(new Error('network failed'));
    else f.resolveContribution({ ok: outcome === 'success', message: 'mock result' });
    await request;
    assert.equal(f.store.list().length, 0, outcome);
    assert.equal(f.saves(), 0, outcome);
  }
});

test('A retained pending record is saved after contribution and duplicate in-flight requests are ignored', async () => {
  const record = { id: 'retained', classContributionStatus: 'pending', rankingMode: 'demo' };
  const f = fixture({ record });
  const first = f.extras.contribute(record);
  await f.extras.contribute(record);
  f.resolveContribution({ ok: true, message: 'mock result' });
  await first;
  assert.equal(record.classContributionStatus, 'demo');
  assert.equal(f.saves(), 1);
  assert.equal(f.store.list().length, 1);
});

test('Unconfirmed contribution stays pending and a late server response updates saved history', async () => {
  const record = { id: 'late', classContributionStatus: 'pending', rankingMode: 'online', competition: {} };
  const f = fixture({ record });
  let settle;
  const completion = new Promise(resolve => { settle = resolve; });
  const request = f.extras.contribute(record);
  f.resolveContribution({ ok: false, pending: true, message: 'unconfirmed', completion });
  await request;
  assert.equal(record.classContributionStatus, 'pending');
  f.state.view = 'home';
  settle({ ok: true, message: 'confirmed' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.store.list()[0].classContributionStatus, 'synced');
});

test('Late completion never resurrects deleted history', async () => {
  const record = { id: 'deleted-late', classContributionStatus: 'pending', competition: {} };
  const f = fixture({ record }); let settle;
  const completion = new Promise(resolve => { settle = resolve; });
  const request = f.extras.contribute(record);
  f.resolveContribution({ ok: false, pending: true, message: 'waiting', completion });
  await request; f.store.clear();
  settle({ ok: true, message: 'stored' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.store.list().length, 0);
});

test('Decimal excluded types and incomplete sessions retain policy and explain non-submission', () => {
  const f = fixture(), s = f.state.session;
  s.trainerId = 'decimal'; s.problems = [{ rankEligibility: false }]; s.isReview = false;
  f.extras.prepare(s);
  s.responses[0].attempts = [{}];
  const record = { total: 5, correct: 0 };
  f.extras.complete(record, true);
  assert.equal(record.rankingEnabled, false);
  assert.equal(record.classContributionStatus, 'not-joined');
  assert.match(f.extras.recordHtml(record), /랭킹 대상이 아닌 소수 유형/);
  s.settings.rankingEnabled = true;
  f.extras.complete(record, false);
  assert.equal(record.classContributionStatus, 'not-joined');
  assert.match(f.extras.recordHtml(record), /끝까지/);
});

test('Changing trainer while submitting keeps same-ID histories and late results isolated', async () => {
  const f = fixture(); const resolvers = {}, stores = {};
  for (const trainerId of ['fraction', 'decimal']) {
    const row = { id: 'same-id', trainerId, competition: {}, classContributionStatus: 'pending' };
    stores[trainerId] = { row, list: () => [stores[trainerId].row], save: value => { stores[trainerId].row = value; return { ok: true }; } };
  }
  f.context.TrainerHistory = { forTrainer: id => stores[id] };
  f.context.MathPlatform = { submit: row => new Promise(resolve => { resolvers[row.trainerId] = resolve; }) };
  const a = f.extras.contribute(stores.fraction.row);
  f.state.trainerId = 'decimal'; f.state.record = stores.decimal.row;
  const b = f.extras.contribute(stores.decimal.row);
  resolvers.decimal({ ok: true, message: 'decimal stored' }); await b;
  resolvers.fraction({ ok: false, message: 'fraction retry' }); await a;
  assert.equal(stores.fraction.row.classContributionStatus, 'failed');
  assert.equal(stores.decimal.row.classContributionStatus, 'synced');
  assert.equal(f.state.record.classContributionMessage, 'decimal stored');
});
