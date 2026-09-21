const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));
const classroom = { schoolName: '배움초등학교', region: '서울 중구', grade: 5, className: '2' };
const now = '2026-09-14T02:00:00Z';
const nextWeek = '2026-09-20T23:00:00Z';
function localStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function moduleAt(context = {}) {
  const sandbox = vm.createContext({ setTimeout, clearTimeout, ...context });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/gamification.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/competition.js'), 'utf8'), sandbox);
  return sandbox.WeeklyCompetition;
}
function firestore() {
  const documents = new Map(), listeners = new Set(), operations = [];
  const snapshot = ref => ({ id: ref.id, exists: documents.has(ref.path), data: () => plain(documents.get(ref.path)) });
  const emit = () => { for (const listener of listeners) listener(); };
  let transactionQueue = Promise.resolve();
  const db = {
    collection(name) {
      return {
        doc(id) {
          const ref = { id, path: `${name}/${id}`, async get() { return snapshot(ref); },
            onSnapshot(callback) { const fn = () => callback(snapshot(ref)); listeners.add(fn); fn(); return () => listeners.delete(fn); } };
          return ref;
        },
        orderBy(field, direction) {
          assert.equal(field, 'score'); assert.equal(direction, 'desc');
          return { limit(limit) { return { onSnapshot(callback) {
            const fn = () => callback({ docs: [...documents.keys()].filter(key => key.startsWith(`${name}/`))
              .map(key => ({ id: key.slice(name.length + 1), data: () => plain(documents.get(key)) }))
              .sort((a, b) => b.data().score - a.data().score).slice(0, limit) });
            listeners.add(fn); fn(); return () => listeners.delete(fn);
          } }; } };
        }
      };
    },
    runTransaction(callback) {
      const run = transactionQueue.then(async () => {
        const writes = [];
        const result = await callback({
          async get(ref) { assert.equal(writes.length, 0, 'All Firestore reads precede writes'); operations.push(['get', ref.path]); return snapshot(ref); },
          set(ref, value, options) { writes.push({ ref, value: plain(value), options }); }
        });
        for (const { ref, value, options } of writes) { operations.push(['set', ref.path]); documents.set(ref.path, options?.merge ? { ...documents.get(ref.path), ...value } : value); }
        if (writes.length) emit();
        return result;
      });
      transactionQueue = run.catch(() => {});
      return run;
    }
  };
  return { db, documents, operations, listeners, emit };
}
function setup(options = {}) {
  const api = moduleAt(), remote = firestore(), local = options.storage || localStorage();
  let time = now, count = 0;
  const clock = () => new Date(time);
  const provider = api.createFirestoreProvider(remote.db, { clock });
  const repo = api.createRepository({ clock, storage: local, random: () => 0, idFactory: () => `draft-${++count}`, onlineProvider: provider, ...options });
  return { api, remote, local, repo, provider, clock, setTime(value) { time = value; } };
}
async function join(env, selectedClass = classroom) {
  const nickname = env.repo.rollNickname(selectedClass).draft.selected;
  const registration = await env.repo.registerNickname(selectedClass, nickname);
  assert.equal(registration.ok, true, registration.message);
  const result = await env.repo.login(selectedClass, nickname);
  assert.equal(result.ok, true, result.message);
  return result.identity;
}
const record = (identity, changes = {}) => ({ id: 'session-1', competition: identity, completed: true, rankingEnabled: true,
  date: now, score: 65, total: 5, correct: 5, firstCorrect: 5, settings: { difficulty: 'normal' }, ...changes });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('Competition import has no network or storage mutation side effects', () => {
  let requests = 0;
  moduleAt({ ClassRanking: { getOnlineProvider() { requests++; throw new Error(); } }, localStorage: { getItem() { requests++; }, setItem() { requests++; } } });
  assert.equal(requests, 0);
});

test('Competition weeks roll exactly at Monday 08:00 Korea, including year and leap boundaries', () => {
  const api = moduleAt();
  assert.deepEqual(plain(api.getWeek('2026-09-13T22:59:59.999Z')), {
    id: '20260907', prevId: '20260831', startMs: Date.parse('2026-09-06T23:00:00Z'), endMs: Date.parse('2026-09-13T23:00:00Z')
  });
  assert.equal(api.getWeek('2026-09-13T23:00:00Z').id, '20260914');
  assert.equal(api.getWeek('2026-09-13T15:00:00Z').id, '20260907', 'Korean midnight does not reset competition');
  assert.equal(api.getWeek('2024-12-29T23:00:00Z').id, '20241230');
  assert.equal(api.getWeek('2024-03-03T22:59:59Z').id, '20240226');
  assert.throws(() => api.getWeek('bad date'), { name: 'RangeError' });
  assert.equal(setup().repo.getWeek().id, '20260914', 'Repository defaults to the injected clock');
});

test('Ten unique dice candidates persist across reload and an unconfirmed draft cannot reset', () => {
  const env = setup();
  for (let i = 1; i <= 10; i++) assert.equal(env.repo.rollNickname(classroom).draft.rolls, i);
  const draft = env.repo.getDraft(classroom);
  assert.equal(new Set(draft.candidates).size, 10);
  assert.ok(draft.candidates.every(name => /하는[가-힣]+$/.test(name)));
  assert.equal(env.repo.rollNickname(classroom).ok, false);
  const reloaded = env.api.createRepository({ clock: env.clock, storage: env.local });
  assert.equal(reloaded.getDraft(classroom).rolls, 10);
  assert.equal(reloaded.startNewDraft(classroom).ok, false);
  assert.equal(reloaded.rollNickname(classroom).ok, false);
});

test('Registration uses a transaction, requires a dice candidate, and becomes identity only after login', async () => {
  const env = setup();
  assert.equal((await env.repo.registerNickname(classroom, '공부하는고양이')).ok, false);
  const nick = env.repo.rollNickname(classroom).draft.selected;
  assert.equal((await env.repo.login(classroom, nick)).ok, false);
  assert.equal((await env.repo.registerNickname(classroom, nick)).ok, true);
  assert.equal(env.repo.getIdentity(), null);
  assert.equal(env.repo.getDraft(classroom).confirmed, nick);
  assert.equal(env.repo.rollNickname(classroom).ok, false);
  assert.equal((await env.repo.login({ ...classroom, className: '3' }, nick)).ok, false);
  assert.equal((await env.repo.login(classroom, ` ${nick} `)).ok, true);
  const reloaded = env.api.createRepository({ clock: env.clock, storage: env.local });
  assert.deepEqual(plain(reloaded.getIdentity()), plain(env.repo.getIdentity()));
  assert.equal(env.remote.documents.size, 2, 'One player and one registration receipt');
});

test('Same-class nickname collisions fail while a different class may use the same nickname', async () => {
  const env = setup(), first = await join(env);
  const other = env.api.createRepository({ clock: env.clock, storage: localStorage(), random: () => 0, idFactory: () => 'other-draft', onlineProvider: env.provider });
  const nick = other.rollNickname(classroom).draft.selected;
  assert.equal(nick, first.nickname);
  assert.equal((await other.registerNickname(classroom, nick)).ok, false);
  const otherClass = { ...classroom, className: '3' };
  assert.equal(other.rollNickname(otherClass).ok, true);
  assert.equal((await other.registerNickname(otherClass, nick)).ok, true);
  assert.equal((await other.login(otherClass, nick)).ok, true);
  assert.notEqual(other.getIdentity().playerId, first.playerId);
});

test('Concurrent confirmations from one draft register exactly one nickname and retries return it', async () => {
  const env = setup();
  env.repo.rollNickname(classroom); env.repo.rollNickname(classroom);
  const [a, b] = env.repo.getDraft(classroom).candidates;
  const responses = await Promise.all([env.repo.registerNickname(classroom, a), env.repo.registerNickname(classroom, b)]);
  assert.ok(responses.every(response => response.ok));
  assert.equal(responses[0].identity.nickname, responses[1].identity.nickname);
  assert.equal(env.remote.documents.size, 2);
  assert.equal((await env.repo.registerNickname(classroom, a)).ok, true);
});

test('A confirmed forgotten nickname allows a fresh ten-roll draft without deleting previous score', async () => {
  const env = setup(), identity = await join(env);
  await env.repo.submit(record(identity));
  assert.equal(env.repo.startNewDraft(classroom).ok, true);
  assert.equal(env.repo.getDraft(classroom).rolls, 0);
  env.repo.rollNickname(classroom);
  const nextNick = env.repo.rollNickname(classroom).draft.selected;
  assert.notEqual(nextNick, identity.nickname);
  assert.equal((await env.repo.registerNickname(classroom, nextNick)).ok, true);
  assert.equal(env.remote.documents.get(`weeklyCompetitionPlayers_20260914/${identity.playerId}`).score, 65);
  assert.equal(env.repo.getIdentity().nickname, identity.nickname, 'New registration alone does not log in');
});

test('Completed scores update class and individual together and concurrent retry receipts prevent double awards', async () => {
  const env = setup(), identity = await join(env);
  const results = await Promise.all([env.repo.submit(record(identity)), env.repo.submit(record(identity))]);
  assert.ok(results.every(result => result.ok));
  assert.equal(results.filter(result => result.duplicate).length, 1);
  for (const name of [`weeklyCompetitionClasses_20260914/${identity.classroom.id}`, `weeklyCompetitionPlayers_20260914/${identity.playerId}`]) {
    const row = env.remote.documents.get(name);
    assert.equal(row.score, 65); assert.equal(row.sessions, 1); assert.equal(row.totalSolved, 5); assert.equal(row.correctCount, 5);
  }
  assert.equal([...env.remote.documents.keys()].some(key => key.startsWith('classGrowth')), false);
});

test('Legacy records retain their original difficulty caps', async () => {
  const env = setup(), identity = await join(env);
  for (const [difficulty, maximum] of [['easy', 75], ['normal', 80], ['challenge', 90]]) {
    assert.equal((await env.repo.submit(record(identity, { id: difficulty, score: maximum, settings: { difficulty } }))).ok, true);
    assert.equal((await env.repo.submit(record(identity, { id: `${difficulty}-bad`, score: maximum + 1, settings: { difficulty } }))).ok, false);
  }
  assert.equal(env.remote.documents.get(`weeklyCompetitionClasses_20260914/${identity.classroom.id}`).score, 245);
});

test('New scoring caps accept variety rewards and reject excess or unknown versions', async () => {
  const env = setup(), identity = await join(env);
  for (const [type, difficulty, maximum] of [['proper-add','easy',3250],['all','challenge',10250]]) {
    const value = record(identity, {id:type,scoringVersion:2,settings:{unit:'g4-addsub',type,difficulty},score:maximum});
    assert.equal((await env.repo.submit(value)).ok,true);
    assert.equal((await env.repo.submit({...value,id:type+'-bad',score:maximum+1})).ok,false);
    assert.equal((await env.repo.submit({...value,id:type+'-unknown',scoringVersion:3})).ok,false);
  }
});

test('Invalid or incomplete records never reach the online provider', async () => {
  const env = setup(), identity = await join(env); let calls = 0;
  const repo = env.api.createRepository({ clock: env.clock, storage: localStorage(), onlineProvider() { calls++; throw new Error('Unexpected request'); } });
  for (const changes of [{ completed: false }, { rankingEnabled: false }, { rankingMode: 'demo' }, { competition: null }, { total: 4 }, { total: 201 }, { score: -1 }, { score: 1.5 }, { correct: 6 }, { firstCorrect: 6 }, { date: 'bad' }, { settings: { difficulty: 'bad' } }]) {
    assert.equal((await repo.submit(record(identity, changes))).ok, false);
  }
  assert.equal(calls, 0);
});

test('Rollover expires identity and old session contributions, leaving last week documents intact', async () => {
  const env = setup(), identity = await join(env);
  await env.repo.submit(record(identity));
  const previous = plain([...env.remote.documents.entries()]);
  env.setTime(nextWeek);
  assert.equal(env.repo.getIdentity(), null);
  assert.equal(env.repo.getSavedIdentity().nickname, identity.nickname);
  assert.equal(env.repo.getDraft(classroom).rolls, 0);
  assert.equal((await env.repo.submit(record(identity, { id: 'late' }))).ok, false);
  assert.equal((await env.repo.login(classroom, identity.nickname)).ok, false);
  assert.deepEqual(plain([...env.remote.documents.entries()]), previous);
  const newIdentity = await join(env);
  assert.equal(newIdentity.weekId, '20260921');
  assert.equal(newIdentity.nickname, identity.nickname, 'Nickname availability resets per week');
});

test('Provider acquisition or a Firestore retry crossing Monday 08:00 cannot write the old week', async () => {
  const env = setup(), identity = await join(env);
  const repo = env.api.createRepository({ clock: env.clock, storage: localStorage(), async onlineProvider() { env.setTime(nextWeek); return env.provider; } });
  const before = env.remote.documents.size;
  assert.equal((await repo.submit(record(identity))).ok, false);
  assert.equal(env.remote.documents.size, before);
  await assert.rejects(env.provider.contribute({ identity, sessionId: 'direct', score: 10, total: 5, firstCorrect: 1, difficulty: 'easy', date: now }), /새 주간/);
});

test('A missing registration or receipt reused by another player cannot add score', async () => {
  const env = setup(), identity = await join(env);
  const fake = { ...identity, nickname: '노래하는고양이', playerId: `${identity.classroom.id}::노래하는고양이` };
  assert.equal((await env.repo.submit(record(fake))).ok, false);
  assert.equal((await env.repo.submit(record(identity))).ok, true);
  assert.equal((await env.repo.submit(record(fake))).ok, false);
  assert.equal(env.remote.documents.get(`weeklyCompetitionClasses_20260914/${identity.classroom.id}`).sessions, 1);
});

test('Transaction overflow leaves both class and individual rows untouched', async () => {
  const env = setup(), identity = await join(env);
  const key = `weeklyCompetitionClasses_20260914/${identity.classroom.id}`;
  env.remote.documents.set(key, { ...identity.classroom, score: Number.MAX_SAFE_INTEGER, sessions: 0, totalSolved: 0, correctCount: 0 });
  assert.equal((await env.repo.submit(record(identity))).ok, false);
  assert.equal(env.remote.documents.get(`weeklyCompetitionPlayers_20260914/${identity.playerId}`).score, 0);
  assert.equal(env.remote.documents.get(key).score, Number.MAX_SAFE_INTEGER);
});

test('Lost registration response is retryable without a second nickname registration', async () => {
  const env = setup(); let first = true;
  const repo = env.api.createRepository({ clock: env.clock, storage: env.local, random: () => 0, idFactory: () => 'lost-registration', timeoutMs: 5, onlineProvider: {
    ...env.provider, async register(payload) { const saved = await env.provider.register(payload); if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 20)); } return saved; }
  } });
  const nick = repo.rollNickname(classroom).draft.selected;
  assert.equal((await repo.registerNickname(classroom, nick)).ok, false);
  assert.equal((await repo.registerNickname(classroom, nick)).ok, true);
  assert.equal(env.remote.documents.size, 2);
  assert.equal(repo.getIdentity(), null);
});

test('Lost contribution response and retry still award only once', async () => {
  const env = setup(), identity = await join(env); let first = true;
  const repo = env.api.createRepository({ clock: env.clock, storage: env.local, timeoutMs: 5, onlineProvider: {
    ...env.provider, async contribute(payload) { const saved = await env.provider.contribute(payload); if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 20)); } return saved; }
  } });
  assert.equal((await repo.submit(record(identity))).ok, false);
  const retried = await repo.submit(record(identity));
  assert.equal(retried.ok, true); assert.equal(retried.duplicate, true);
  assert.equal(env.remote.documents.get(`weeklyCompetitionClasses_20260914/${identity.classroom.id}`).score, 65);
});

test('Pending login cancellation preserves previous identity and stops late identity replacement', async () => {
  const env = setup(), identity = await join(env); let release;
  const repo = env.api.createRepository({ clock: env.clock, storage: env.local, onlineProvider: {
    ...env.provider, login(value) { return new Promise(resolve => { release = () => resolve(value); }); }
  } });
  const pending = repo.login(classroom, identity.nickname);
  await flush(); repo.cancelPendingLogin(); release();
  assert.equal((await pending).ok, false);
  assert.equal(repo.getIdentity().nickname, identity.nickname);
  const next = repo.login(classroom, identity.nickname);
  await flush(); repo.clearIdentity(); release();
  assert.equal((await next).ok, false);
  assert.equal(repo.getIdentity(), null);
});

test('A login response arriving in a new week never creates an active stale identity', async () => {
  const env = setup(), identity = await join(env);
  const repo = env.api.createRepository({ clock: env.clock, storage: localStorage(), onlineProvider: { ...env.provider, async login() { env.setTime(nextWeek); return identity; } } });
  assert.equal((await repo.login(classroom, identity.nickname)).ok, false);
  assert.equal(repo.getSavedIdentity(), null);
});

test('Old storage keys and unrecognized new storage data are preserved', async () => {
  const old = { 'bunsu.learning.v1': '{old history}', 'bunsu.game.v1': '{old growth}', 'bunsu.class.v1': '{old class}', 'bunsu.ranking.v1': '{old demo}' };
  const local = localStorage({ ...old, 'bunsu.competition.identity.v1': '{damaged json}', 'bunsu.competition.drafts.v1': '{"version":99,"drafts":{}}' });
  const env = setup({ storage: local });
  assert.equal(env.repo.getIdentity(), null);
  await join(env);
  for (const [key, value] of Object.entries(old)) assert.equal(local.getItem(key), value);
  assert.equal(local.getItem(env.api.keys.identity), '{damaged json}');
  assert.equal(local.getItem(env.api.keys.drafts), '{"version":99,"drafts":{}}');
  assert.ok(env.repo.getIdentity(), 'Unavailable storage keeps this tab usable');
});

test('Unavailable localStorage remains usable in memory and never leaks parsing errors', async () => {
  const env = setup({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } } });
  const identity = await join(env);
  assert.equal(env.repo.getIdentity().nickname, identity.nickname);
  env.repo.clearIdentity(); assert.equal(env.repo.getIdentity(), null);
});

test('Invalid classroom and forged nicknames are rejected before registration or login requests', async () => {
  const env = setup();
  for (const changed of [{ schoolName: 'bad/path' }, { region: '' }, { grade: 3 }, { className: '31' }, { className: '1.5' }]) {
    assert.equal(env.repo.rollNickname({ ...classroom, ...changed }).ok, false);
  }
  assert.equal((await env.repo.login(classroom, '<script>')).ok, false);
  assert.equal((await env.repo.registerNickname(classroom, '__proto__')).ok, false);
  assert.equal(env.remote.operations.length, 0);
});

test('Realtime class and personal watchers refresh together and clean up all snapshot listeners', async () => {
  const env = setup(), identity = await join(env), classes = [], people = [];
  const closeClass = env.repo.watchRankings({ kind: 'class' }, data => classes.push(plain(data)), error => assert.fail(error.message));
  const closePerson = env.repo.watchRankings({ kind: 'individual' }, data => people.push(plain(data)), error => assert.fail(error.message));
  await flush();
  assert.equal(env.remote.listeners.size, 4);
  await env.repo.submit(record(identity));
  assert.equal(classes.at(-1).own.score, 65);
  assert.equal(people.at(-1).own.score, 65);
  assert.equal(people.at(-1).rows[0].nickname, identity.nickname);
  closeClass(); closePerson();
  assert.equal(env.remote.listeners.size, 0);
  const classCount = classes.length; env.remote.emit(); assert.equal(classes.length, classCount);
});

test('Previous-week ranking stays visible while current-week rankings start empty', async () => {
  const env = setup(), identity = await join(env);
  await env.repo.submit(record(identity)); env.setTime(nextWeek);
  let current, previous, individual;
  const closers = [env.repo.watchRankings({ week: 'current', kind: 'class' }, data => { current = data; }),
    env.repo.watchRankings({ week: 'prev', kind: 'class' }, data => { previous = data; }),
    env.repo.watchRankings({ week: 'prev', kind: 'individual' }, data => { individual = data; })];
  await flush();
  assert.equal(current.weekId, '20260921'); assert.equal(current.rows.length, 0);
  assert.equal(previous.weekId, '20260914'); assert.equal(previous.rows[0].score, 65);
  assert.equal(individual.rows[0].nickname, identity.nickname);
  assert.equal(individual.own.score, 65);
  closers.forEach(close => close());
});

test('Unsubscribe before asynchronous provider availability never starts a listener', async () => {
  const env = setup(); let release, calls = 0;
  const repo = env.api.createRepository({ clock: env.clock, storage: env.local, onlineProvider: () => new Promise(resolve => { release = () => resolve({ watch() { calls++; return () => {}; } }); }) });
  const close = repo.watchRankings({}, () => assert.fail('Unsubscribed listener emitted'));
  close(); release(); await flush();
  assert.equal(calls, 0);
});

test('An open ranking automatically switches week subscriptions at Monday 08:00', async () => {
  let scheduled, cancelled = 0;
  const env = setup({ setTimeout(callback, delay) { scheduled = { callback, delay }; return 1; }, clearTimeout() { cancelled++; } });
  let latest;
  const close = env.repo.watchRankings({}, value => { latest = value; });
  await flush();
  assert.equal(latest.weekId, '20260914'); assert.ok(scheduled.delay > 0);
  env.setTime(nextWeek); scheduled.callback(); await flush();
  assert.equal(latest.weekId, '20260921');
  assert.equal(env.remote.listeners.size, 1);
  close(); assert.equal(cancelled, 1); assert.equal(env.remote.listeners.size, 0);
});

test('Provider connection failures go to the error callback and never supply sample rankings', async () => {
  const env = setup({ onlineProvider() { throw new Error('permission-denied'); }, setTimeout() { return 1; }, clearTimeout() {} });
  const errors = [], results = [];
  const close = env.repo.watchRankings({}, value => results.push(value), error => errors.push(error.message));
  await flush(); close();
  assert.deepEqual(results, []); assert.equal(errors.length, 1); assert.match(errors[0], /permission-denied/);
});
