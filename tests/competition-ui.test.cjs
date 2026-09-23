const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/competition-ui.js'), 'utf8');
const classroom = { id: 'class-a', schoolName: '배움초등학교', region: '서울', grade: 4, className: '1' };
const escaped = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture(options = {}) {
  let selection = options.noSelection ? null : { ...classroom }, identity = options.identity || null;
  let currentWeek = { id: '20260914', prevId: '20260907', endMs: Date.now() + 86400000 };
  let currentDraft = { rolls: 0, candidates: [], selected: '', confirmed: null, ...options.draft };
  const timers = new Map(), watchers = [], calls = { search: 0, register: 0, login: 0, cancel: 0, entered: [] };
  let nextTimer = 0, renders = 0;
  const context = vm.createContext({
    Date,
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    ClassRanking: {
      getSelection: () => selection,
      selectClass(value) { selection = { ...value, id: `class-${value.grade}-${value.className}` }; return { ok: true }; },
      searchSchools() { calls.search++; return options.search || Promise.resolve([{ ...classroom }]); }
    },
    WeeklyCompetition: {
      getWeek: () => currentWeek,
      getIdentity: () => identity,
      getSavedIdentity: () => identity,
      getDraft: () => currentDraft,
      cancelPendingLogin() { calls.cancel++; },
      rollNickname() {
        if (currentDraft.confirmed || currentDraft.rolls >= 10) return { ok: false, message: '10번까지 굴릴 수 있어요.' };
        currentDraft.rolls++; currentDraft.selected = `공부하는토끼${currentDraft.rolls}`;
        currentDraft.candidates.push(currentDraft.selected);
        return { ok: true, draft: currentDraft };
      },
      startNewDraft() { currentDraft = { rolls: 0, candidates: [], selected: '', confirmed: null }; return { ok: true }; },
      async registerNickname(value, nickname) {
        calls.register++;
        const result = options.register ? await options.register : { ok: true, identity: { nickname, classroom: value, weekId: currentWeek.id } };
        if (result.ok) currentDraft.confirmed = nickname;
        return result;
      },
      async login(value, nickname) {
        calls.login++;
        return options.login ? await options.login : { ok: true, identity: { nickname, classroom: value, weekId: currentWeek.id } };
      },
      watchRankings(value, onData, onError) {
        const watcher = { ...value, onData, onError, active: true }; watchers.push(watcher);
        return () => { watcher.active = false; };
      }
    }
  });
  vm.runInContext(source, context);
  const ui = context.CompetitionUI.create({ esc: escaped,
    button: (action, text, style = '', icon = '', attrs = '') => `<button class="btn ${style}" data-action="${action}" ${attrs}>${text}</button>`,
    notify() {}, onChange() { renders++; }, onEnter(value) { calls.entered.push(value); }
  });
  return { ui, calls, timers, watchers, renders: () => renders, draft: () => currentDraft,
    nextWeek() { currentWeek = { id: '20260921', prevId: '20260914', endMs: Date.now() + 86400000 }; },
    fireTimer() { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); }
  };
}

test('Entry opens with or without a saved class and preserves a confirmed nickname', () => {
  const empty = fixture({ noSelection: true }); empty.ui.openEntry();
  assert.match(empty.ui.entryHtml(), /먼저 학교와 학년, 반을 선택/);
  const saved = fixture({ draft: { confirmed: '공부하는토끼', selected: '공부하는토끼', candidates: ['공부하는토끼'] } });
  saved.ui.openEntry();
  assert.match(saved.ui.entryHtml(), /id="competition-nickname" value="공부하는토끼"/);
});

test('Dice stops at ten rolls and a previously rolled candidate can be registered', async () => {
  const f = fixture(); f.ui.openEntry(); f.ui.input({target:{id:'competition-pin',value:'123456'}}); f.ui.input({target:{id:'competition-pin-confirm',value:'123456'}});
  for (let i = 0; i < 11; i++) f.ui.action('competition-roll');
  assert.equal(f.draft().rolls, 10);
  f.ui.action('competition-candidate', '2'); f.ui.action('competition-confirm'); await tick();
  assert.equal(f.draft().confirmed, '공부하는토끼3');
  assert.match(f.ui.entryHtml(), /value="공부하는토끼3"/);
  assert.equal(f.calls.entered.length, 0, 'Registration waits for a separate entry action');
  f.ui.action('competition-enter'); await tick();
  assert.equal(f.calls.entered[0].nickname, '공부하는토끼3');
});

test('Duplicate confirmation and entry clicks make only one request while busy', async () => {
  const registration = deferred(), login = deferred();
  const f = fixture({ register: registration.promise, login: login.promise }); f.ui.openEntry(); f.ui.input({target:{id:'competition-pin',value:'123456'}}); f.ui.input({target:{id:'competition-pin-confirm',value:'123456'}});
  f.ui.action('competition-roll'); f.ui.action('competition-confirm'); f.ui.action('competition-confirm'); await tick();
  assert.equal(f.calls.register, 1);
  registration.resolve({ ok: true, identity: { nickname: '공부하는토끼1' } }); await tick();
  f.ui.action('competition-enter'); f.ui.action('competition-enter'); await tick();
  assert.equal(f.calls.login, 1);
  login.resolve({ ok: true, identity: { nickname: '공부하는토끼1' } }); await tick();
  assert.equal(f.calls.entered.length, 1);
});

test('Input stays intact across rerenders and existing nicknames can enter directly', async () => {
  const f = fixture(); f.ui.openEntry(); f.ui.input({target:{id:'competition-pin',value:'123456'}}); f.ui.input({target:{id:'competition-pin-confirm',value:'123456'}});
  f.ui.input({ target: { id: 'competition-school-query', value: '서울 배움' } });
  f.ui.input({ target: { id: 'competition-nickname', value: '노래하는나무' } });
  f.ui.action('competition-roll');
  const html = f.ui.entryHtml();
  assert.match(html, /value="서울 배움"/); assert.match(html, /value="노래하는나무"/);
  f.ui.action('competition-enter'); await tick();
  assert.equal(f.calls.entered[0].nickname, '노래하는나무');
  assert.equal(f.calls.register, 0);
});

test('School search rejects a short query, deduplicates requests, and discards late results', async () => {
  const search = deferred(), f = fixture({ search: search.promise }); f.ui.openEntry(); f.ui.input({target:{id:'competition-pin',value:'123456'}}); f.ui.input({target:{id:'competition-pin-confirm',value:'123456'}});
  f.ui.action('competition-search');
  assert.match(f.ui.entryHtml(), /두 글자 이상 입력/); assert.equal(f.calls.search, 0);
  f.ui.input({ target: { id: 'competition-school-query', value: '배움' } });
  f.ui.action('competition-search'); f.ui.action('competition-search'); await tick();
  assert.equal(f.calls.search, 1);
  f.ui.leave(); const renders = f.renders(); search.resolve([{ ...classroom }]); await tick();
  assert.equal(f.renders(), renders);
});

test('Class edits invalidate pending registration without restoring the old nickname', async () => {
  const registration = deferred(), f = fixture({ register: registration.promise }); f.ui.openEntry(); f.ui.input({target:{id:'competition-pin',value:'123456'}}); f.ui.input({target:{id:'competition-pin-confirm',value:'123456'}});
  f.ui.action('competition-roll'); f.ui.action('competition-confirm'); await tick();
  f.ui.change({ target: { value: '5', dataset: { competitionField: 'grade' } } });
  registration.resolve({ ok: true, identity: { nickname: '공부하는토끼1' } }); await tick();
  assert.doesNotMatch(f.ui.entryHtml(), /등록 완료!/);
  assert.match(f.ui.entryHtml(), /먼저 학교와 학년, 반을 선택/);
  assert.equal(f.calls.entered.length, 0);
});

test('A pending login cannot enter after leaving or crossing a week boundary', async () => {
  for (const transition of ['leave', 'week']) {
    const login = deferred(), f = fixture({ login: login.promise }); f.ui.openEntry(); f.ui.input({target:{id:'competition-pin',value:'123456'}}); f.ui.input({target:{id:'competition-pin-confirm',value:'123456'}});
    f.ui.input({ target: { id: 'competition-nickname', value: '공부하는토끼' } });
    f.ui.action('competition-enter'); await tick();
    if (transition === 'leave') f.ui.leave(); else { f.nextWeek(); f.fireTimer(); }
    login.resolve({ ok: true, identity: { nickname: '공부하는토끼' } }); await tick();
    assert.equal(f.calls.entered.length, 0, transition);
    assert.ok(f.calls.cancel >= 2);
  }
});

test('Nickname errors are displayed and retry is available', async () => {
  const f = fixture({ login: Promise.resolve({ ok: false, message: '등록한 닉네임을 찾을 수 없어요.' }) });
  f.ui.openEntry(); f.ui.input({target:{id:'competition-pin',value:'123456'}}); f.ui.input({target:{id:'competition-pin-confirm',value:'123456'}}); f.ui.input({ target: { id: 'competition-nickname', value: '없는닉네임' } });
  f.ui.action('competition-enter'); await tick();
  assert.match(f.ui.entryHtml(), /등록한 닉네임을 찾을 수 없어요/);
  assert.doesNotMatch(f.ui.entryHtml(), /입장 중…/);
  f.ui.action('competition-enter'); await tick(); assert.equal(f.calls.login, 2);
});

test('Board shows both weeks, switches between class and individual, and cleans up subscriptions', () => {
  const f = fixture(); f.ui.openBoard();
  assert.equal(f.watchers.filter(value => value.active).length, 2);
  assert.match(f.ui.boardHtml(), /이번 주 실시간/); assert.match(f.ui.boardHtml(), /지난주 결과/);
  const previousWatcher = f.watchers[0];
  f.ui.action('competition-kind', 'individual');
  assert.equal(f.watchers.filter(value => value.active).length, 2);
  assert.ok(f.watchers.filter(value => value.active).every(value => value.kind === 'individual'));
  const renders = f.renders(); previousWatcher.onData({ rows: [], weekId: '20260914' });
  assert.equal(f.renders(), renders);
  f.ui.leave(); f.ui.leave();
  assert.equal(f.watchers.filter(value => value.active).length, 0); assert.equal(f.timers.size, 0);
});

test('Board rollover replaces both subscriptions and keeps a single timer', () => {
  const f = fixture(); f.ui.openBoard();
  assert.equal(f.timers.size, 1);
  f.nextWeek(); f.fireTimer();
  assert.equal(f.watchers.length, 4); assert.equal(f.watchers.filter(value => value.active).length, 2);
  assert.equal(f.timers.size, 1); assert.match(f.ui.boardHtml(), /2026\.09\.21/);
  f.ui.openEntry(); f.ui.input({target:{id:'competition-pin',value:'123456'}}); f.ui.input({target:{id:'competition-pin-confirm',value:'123456'}}); assert.equal(f.timers.size, 1); assert.equal(f.watchers.filter(value => value.active).length, 0);
  f.ui.destroy(); assert.equal(f.timers.size, 0);
});

test('Board escapes server names and does not invent an exact rank outside the top fifty', () => {
  const f = fixture(); f.ui.openBoard();
  f.watchers[0].onData({ rows: [{ ...classroom, schoolName: '<img onerror=bad>', score: 20 }],
    own: { ...classroom, id: 'own', score: 10 }, weekId: '20260914' });
  const html = f.ui.boardHtml();
  assert.match(html, /&lt;img onerror=bad&gt;/); assert.doesNotMatch(html, /<img onerror/);
  assert.match(html, /목록 밖/); assert.match(html, /정확한 순위는 제공되지 않아요/);
});

test('A failed realtime subscription displays its error and refresh replaces old listeners', () => {
  const f = fixture(); f.ui.openBoard();
  f.watchers[0].onError(new Error('서버에 연결할 수 없어요.'));
  assert.match(f.ui.boardHtml(), /서버에 연결할 수 없어요/);
  f.ui.action('competition-refresh');
  assert.equal(f.watchers.filter(value => value.active).length, 2);
  assert.doesNotMatch(f.ui.boardHtml(), /서버에 연결할 수 없어요/);
});

test('Both weekly ranking kinds render accessible gold, silver and bronze medals', () => {
  const f = fixture(); f.ui.openBoard();
  for (const kind of ['class', 'individual']) {
    f.ui.action('competition-kind', kind);
    const current = f.watchers.filter(w => w.active && w.week === 'current')[0];
    current.onData({ rows: [1,2,3,4].map(n => ({ ...classroom, id: String(n), classroom, nickname: `학생${n}`, score: 100-n })) });
    const html = f.ui.boardHtml();
    for (const [index, medal] of ['🥇','🥈','🥉'].entries()) {
      assert.ok(html.includes(`aria-label="${index+1}위">${medal}`));
    }
    assert.ok(html.includes('competition-position">4</span>'));
  }
});
