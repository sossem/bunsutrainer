/* Weekly student competition. Existing growth rankings and saved data stay separate. */
(function (root) {
  'use strict';
  const DAY = 86400000, WEEK = 7 * DAY, HOUR = 3600000;
  const KEYS = Object.freeze({ identity: 'bunsu.competition.identity.v1', drafts: 'bunsu.competition.drafts.v1' });
  const VERBS = Object.freeze(['공부하는', '노래하는', '산책하는', '생각하는', '도전하는', '응원하는', '운동하는', '여행하는', '독서하는', '요리하는', '인사하는', '연주하는', '수영하는', '상상하는', '발표하는', '탐험하는', '질문하는', '관찰하는', '협동하는', '연습하는']);
  const LIVING = Object.freeze(['고양이', '강아지', '토끼', '다람쥐', '여우', '호랑이', '사자', '곰', '판다', '코알라', '펭귄', '돌고래', '고래', '수달', '사슴', '기린', '코끼리', '부엉이', '참새', '병아리', '오리', '앵무새', '거북이', '햄스터', '고슴도치', '나비', '잠자리', '꿀벌', '무당벌레', '알파카', '해바라기', '민들레', '장미', '튤립', '백합', '수선화', '소나무', '대나무', '단풍나무', '벚나무', '클로버', '라벤더', '코스모스', '연꽃', '동백', '개나리', '진달래', '수국', '철쭉', '봉선화']);
  const copy = value => JSON.parse(JSON.stringify(value));
  const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const integer = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
  const scoreMax = Object.freeze({ easy: 15, normal: 16, challenge: 18 });
  function getWeek(now = new Date()) {
    const time = new Date(now).getTime();
    if (!Number.isFinite(time)) throw new RangeError('학습 날짜를 확인해 주세요.');
    // Shift Korea's Monday 08:00 to UTC Monday 00:00 before finding the week.
    const shifted = time + HOUR;
    const midnight = Math.floor(shifted / DAY) * DAY;
    const day = new Date(midnight).getUTCDay();
    const monday = midnight - (day === 0 ? 6 : day - 1) * DAY;
    const format = value => new Date(value).toISOString().slice(0, 10).replace(/-/g, '');
    return { id: format(monday), prevId: format(monday - WEEK), startMs: monday - HOUR, endMs: monday - HOUR + WEEK };
  }
  function classroomFrom(value) {
    if (!value || typeof value !== 'object') return null;
    const schoolName = clean(value.schoolName), region = clean(value.region);
    const grade = Number(value.grade), classNumber = Number(value.className);
    if (!schoolName || schoolName.length > 100 || !region || region.length > 80 || /[\/\x00-\x1f]/.test(schoolName + region)
      || !/^[0-9]+$/.test(String(value.grade)) || !/^[0-9]+$/.test(String(value.className))
      || !integer(grade, 6) || grade < 4 || !integer(classNumber, 30) || classNumber < 1) return null;
    const className = String(classNumber);
    return { schoolName, region, grade, className, id: `[${region}] ${schoolName} ${grade}학년 ${className}반` };
  }
  const nicknameValid = value => typeof value === 'string' && VERBS.some(verb => value.startsWith(verb) && LIVING.includes(value.slice(verb.length)));
  const playerIdFor = (classroom, nickname) => `${classroom.id}::${nickname}`;
  function identityFrom(value) {
    const classroom = classroomFrom(value?.classroom);
    if (!classroom || !nicknameValid(value.nickname) || !/^\d{8}$/.test(value.weekId)
      || value.playerId !== playerIdFor(classroom, value.nickname)) return null;
    return { weekId: value.weekId, playerId: value.playerId, nickname: value.nickname, classroom };
  }
  const collections = weekId => ({ classes: `weeklyCompetitionClasses_${weekId}`, players: `weeklyCompetitionPlayers_${weekId}`, receipts: `weeklyCompetitionReceipts_${weekId}` });
  const failure = message => ({ ok: false, message });
  const validPin = pin => typeof pin === 'string' && /^\d{6}$/.test(pin);
  async function pinHash(pin, salt) {
    if (!validPin(pin)) throw new Error('PIN은 숫자 6자리로 입력해 주세요.');
    if (!root.crypto?.subtle) throw new Error('PIN 보호를 위해 HTTPS 또는 localhost로 접속해 주세요.');
    const key = await root.crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await root.crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 600000, hash: 'SHA-256' }, key, 256);
    return Array.from(new Uint8Array(bits), n => n.toString(16).padStart(2, '0')).join('');
  }
  const expiredMessage = '새 주간이 시작됐어요. 학교와 반을 선택하고 이번 주 닉네임으로 다시 입장해 주세요.';
  function deadline(promise, milliseconds, message) {
    let timer;
    return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]).finally(() => clearTimeout(timer));
  }
  function createFirestoreProvider(db, options = {}) {
    const clock = options.clock || (() => new Date());
    const assertWeek = weekId => { if (getWeek(clock()).id !== weekId) throw new Error(expiredMessage); };
    return Object.freeze({
      async register({ identity, draftId, pin }) {
        const salt = root.crypto.randomUUID();
        const credential = { salt, hash: await pinHash(pin, salt) };
        const names = collections(identity.weekId);
        const playerRef = db.collection(names.players).doc(identity.playerId);
        const claimRef = db.collection(names.receipts).doc(`nickname-${draftId}`);
        return db.runTransaction(async transaction => {
          assertWeek(identity.weekId);
          const claim = await transaction.get(claimRef);
          if (claim.exists) {
            const saved = identityFrom(claim.data().identity);
            if (!saved || saved.classroom.id !== identity.classroom.id) throw new Error('닉네임 등록 정보를 확인해 주세요.');
            const existing = await transaction.get(db.collection(names.players).doc(saved.playerId));
            const protection = existing.data()?.pinCredential;
            if (!protection || await pinHash(pin, protection.salt) !== protection.hash) throw new Error('등록할 때 사용한 PIN을 입력해 주세요.');
            return { identity: saved, duplicate: true };
          }
          const player = await transaction.get(playerRef);
          if (player.exists) throw new Error('같은 반에서 이미 사용 중인 닉네임이에요. 다른 후보를 선택해 주세요.');
          assertWeek(identity.weekId);
          transaction.set(playerRef, { ...identity, pinCredential: credential, score: 0, sessions: 0, totalSolved: 0, correctCount: 0, createdAt: new Date(clock()).toISOString(), scoreVersion: 3 });
          transaction.set(claimRef, { kind: 'nickname', identity, draftId, scoreVersion: 3 });
          return { identity, duplicate: false };
        });
      },
      async login(identity, pin) {
        assertWeek(identity.weekId);
        const snapshot = await db.collection(collections(identity.weekId).players).doc(identity.playerId).get();
        if (!snapshot.exists) return null;
        const protection = snapshot.data().pinCredential;
        if (!protection) throw new Error('PIN 도입 전 닉네임이에요. 기존 점수는 보존되며, 새 닉네임과 PIN으로 시작해 주세요.');
        if (await pinHash(pin, protection.salt) !== protection.hash) throw new Error('닉네임 또는 PIN을 확인해 주세요.');
        assertWeek(identity.weekId);
        return snapshot.exists ? identityFrom(snapshot.data()) : null;
      },
      async contribute(payload) {
        if (!await this.login(payload.identity, payload.pin)) throw new Error('PIN으로 다시 입장해 주세요.');
        const names = collections(payload.identity.weekId);
        const playerRef = db.collection(names.players).doc(payload.identity.playerId);
        const classRef = db.collection(names.classes).doc(payload.identity.classroom.id);
        const receiptRef = db.collection(names.receipts).doc(`session-${encodeURIComponent(payload.sessionId)}`);
        return db.runTransaction(async transaction => {
          assertWeek(payload.identity.weekId);
          const receipt = await transaction.get(receiptRef);
          if (receipt.exists) {
            const saved = receipt.data();
            if (saved.playerId !== payload.identity.playerId) throw new Error('이미 다른 닉네임으로 반영된 학습 기록이에요.');
            return { duplicate: true };
          }
          const player = await transaction.get(playerRef);
          const previousClass = await transaction.get(classRef);
          const previousPlayer = player.exists ? player.data() : null;
          const registered = identityFrom(previousPlayer);
          if (!registered || registered.playerId !== payload.identity.playerId || registered.weekId !== payload.identity.weekId) throw new Error('이번 주 닉네임 등록을 확인할 수 없어요. 다시 입장해 주세요.');
          const addScore = previous => {
            const result = {};
            for (const [key, addition] of Object.entries({ score: payload.score, sessions: 1, totalSolved: payload.total, correctCount: payload.firstCorrect })) {
              const old = previous?.[key] ?? 0;
              if (!integer(old) || !integer(old + addition)) throw new Error('누적 점수 정보를 확인해 주세요.');
              result[key] = old + addition;
            }
            return { ...result, updatedAt: payload.date, scoreVersion: 3 };
          };
          const playerScore = addScore(previousPlayer), classScore = addScore(previousClass.exists ? previousClass.data() : null);
          assertWeek(payload.identity.weekId);
          transaction.set(playerRef, playerScore, { merge: true });
          transaction.set(classRef, { ...payload.identity.classroom, weekId: payload.identity.weekId, ...classScore }, { merge: true });
          transaction.set(receiptRef, { kind: 'session', sessionId: payload.sessionId, playerId: payload.identity.playerId, classId: payload.identity.classroom.id,
            weekId: payload.identity.weekId, score: payload.score, total: payload.total, firstCorrect: payload.firstCorrect, difficulty: payload.difficulty, completedAt: payload.date, scoreVersion: 3 });
          return { duplicate: false };
        });
      },
      watch({ weekId, kind, ownId }, onData, onError) {
        const reference = db.collection(collections(weekId)[kind === 'individual' ? 'players' : 'classes']);
        let active = true, rows = [], own = null;
        const unsubscribe = [];
        const stop = () => { active = false; for (const close of unsubscribe.splice(0)) close(); };
        const fail = error => { if (active) { stop(); onError(error); } };
        const emit = () => { if (active) onData({ rows, own: rows.find(row => row.id === ownId) || own, weekId }); };
        try {
          const closeRows = reference.orderBy('score', 'desc').limit(50).onSnapshot(snapshot => {
            rows = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })); emit();
          }, fail);
          if (active) unsubscribe.push(closeRows); else closeRows();
          if (ownId && active) {
            const closeOwn = reference.doc(ownId).onSnapshot(snapshot => { own = snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null; emit(); }, fail);
            if (active) unsubscribe.push(closeOwn); else closeOwn();
          }
        } catch (error) { fail(error); }
        return stop;
      }
    });
  }
  async function defaultProvider() {
    if (!root.ClassRanking?.getOnlineProvider) throw new Error('온라인 랭킹 연결을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.');
    const provider = await root.ClassRanking.getOnlineProvider();
    return createFirestoreProvider(provider.getDatabase());
  }
  function createRepository(options = {}) {
    const clock = options.clock || (() => new Date()), random = options.random || Math.random;
    const network = options.onlineProvider || defaultProvider, timeout = options.timeoutMs ?? 8000;
    const schedule = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
    const memory = new Map(), blocked = new Set();
    let storage, identityEpoch = 0, idCounter = 0, authenticated = null, sessionPin = null;
    let failedLogins = 0, retryAfter = 0;
    try { storage = Object.prototype.hasOwnProperty.call(options, 'storage') ? options.storage : root.localStorage; } catch (_) { storage = null; }
    const provider = async () => typeof network === 'function' ? network() : network;
    function read(key, fallback) {
      let raw = memory.get(key);
      if (!blocked.has(key)) { try { if (storage) raw = storage.getItem(key); } catch (_) { blocked.add(key); } }
      if (!raw) return copy(fallback);
      try { const value = JSON.parse(raw); if (!value || value.version !== 1) throw new Error(); memory.set(key, raw); return value; }
      catch (_) { blocked.add(key); return copy(fallback); }
    }
    function write(key, value) {
      const raw = JSON.stringify(value); memory.set(key, raw);
      try { if (storage && !blocked.has(key)) storage.setItem(key, raw); } catch (_) { blocked.add(key); }
    }
    const newId = () => options.idFactory ? options.idFactory() : root.crypto?.randomUUID ? root.crypto.randomUUID() : `${new Date(clock()).getTime()}-${Math.floor(random() * 0x100000000).toString(36)}-${++idCounter}-${Math.floor(Math.random() * 0x100000000).toString(36)}`;
    function getSavedIdentity() { return identityFrom(read(KEYS.identity, { version: 1, identity: null }).identity); }
    function getIdentity() { getSavedIdentity(); return authenticated?.weekId === getWeek(clock()).id ? copy(authenticated) : null; }
    function clearIdentity() {
      authenticated = null; sessionPin = null;
      identityEpoch++; memory.delete(KEYS.identity);
      try { if (storage) storage.removeItem(KEYS.identity); } catch (_) { blocked.add(KEYS.identity); }
    }
    function cancelPendingLogin() { identityEpoch++; }
    function draftState() {
      const state = read(KEYS.drafts, { version: 1, drafts: {} });
      if (!state.drafts || typeof state.drafts !== 'object' || Array.isArray(state.drafts)) return { version: 1, drafts: {} };
      return state;
    }
    const draftKey = classroom => `${getWeek(clock()).id}|${classroom.id}`;
    const emptyDraft = () => ({ id: '', rolls: 0, candidates: [], selected: '', confirmed: null });
    function getDraft(value) {
      const classroom = classroomFrom(value);
      if (!classroom) return emptyDraft();
      const draft = draftState().drafts[draftKey(classroom)];
      if (!draft) return emptyDraft();
      if (typeof draft.id !== 'string' || !integer(draft.rolls, 10) || !Array.isArray(draft.candidates)
        || draft.candidates.length !== draft.rolls || !draft.candidates.every(nicknameValid)
        || new Set(draft.candidates).size !== draft.candidates.length) return { ...emptyDraft(), rolls: 10 };
      return { id: draft.id, rolls: draft.rolls, candidates: [...draft.candidates], selected: draft.candidates.includes(draft.selected) ? draft.selected : draft.candidates.at(-1) || '', confirmed: draft.candidates.includes(draft.confirmed) ? draft.confirmed : null };
    }
    function saveDraft(classroom, draft) {
      const state = draftState();
      Object.defineProperty(state.drafts, draftKey(classroom), { value: draft, enumerable: true, writable: true, configurable: true });
      write(KEYS.drafts, state);
    }
    function rollNickname(value) {
      const classroom = classroomFrom(value);
      if (!classroom) return failure('학교와 학년, 반을 먼저 선택해 주세요.');
      const draft = getDraft(classroom);
      if (draft.confirmed) return { ...failure('닉네임을 이미 확정했어요. 입력칸에 닉네임을 적고 입장해 주세요.'), draft };
      if (draft.rolls >= 10) return { ...failure('주사위 10회를 모두 사용했어요. 지금까지 나온 후보에서 선택해 주세요.'), draft };
      const length = VERBS.length * LIVING.length;
      let index = Math.max(0, Math.min(length - 1, Math.floor(random() * length)));
      let nickname;
      do { nickname = VERBS[Math.floor(index / LIVING.length)] + LIVING[index % LIVING.length]; index = (index + 1) % length; } while (draft.candidates.includes(nickname));
      draft.id = draft.id || newId(); draft.rolls++; draft.candidates.push(nickname); draft.selected = nickname;
      saveDraft(classroom, draft);
      return { ok: true, draft: copy(draft), message: `${draft.rolls}/10회 · 마음에 드는 닉네임을 확정해 주세요.` };
    }
    function startNewDraft(value) {
      const classroom = classroomFrom(value);
      if (!classroom) return failure('학교와 학년, 반을 먼저 선택해 주세요.');
      const draft = getDraft(classroom), saved = getIdentity();
      if (!draft.confirmed && !(saved?.classroom.id === classroom.id && !draft.rolls)) return { ...failure('먼저 현재 후보에서 닉네임을 확정해 주세요.'), draft };
      const next = { ...emptyDraft(), id: newId() };
      saveDraft(classroom, next);
      return { ok: true, draft: next, message: '새 닉네임을 발급받을 수 있어요. 기존 닉네임의 점수는 그대로 남아요.' };
    }
    async function registerNickname(value, nickname, pin) {
      if (!validPin(pin)) return failure('PIN은 숫자 6자리로 입력해 주세요.');
      const classroom = classroomFrom(value), draft = getDraft(classroom), weekId = getWeek(clock()).id;
      if (!classroom || !draft.id || !draft.candidates.includes(nickname) || (draft.confirmed && draft.confirmed !== nickname)) return failure('주사위로 나온 후보 중에서 닉네임을 선택해 주세요.');
      const identity = { weekId, playerId: playerIdFor(classroom, nickname), nickname, classroom };
      try {
        const remote = await deadline(provider(), timeout, '온라인 연결을 확인하지 못했어요. 다시 시도해 주세요.');
        if (getWeek(clock()).id !== weekId) return failure(expiredMessage);
        const result = await deadline(remote.register({ identity, draftId: draft.id, pin }), timeout, '등록 결과를 아직 확인하지 못했어요. 같은 닉네임과 PIN으로 다시 확정해 주세요.');
        if (getWeek(clock()).id !== weekId) return failure(expiredMessage);
        const registered = identityFrom(result.identity);
        if (!registered || registered.weekId !== weekId || registered.classroom.id !== classroom.id || !draft.candidates.includes(registered.nickname)) return failure('닉네임 등록 결과를 확인해 주세요.');
        const currentDraft = getDraft(classroom);
        if (currentDraft.id === draft.id) saveDraft(classroom, { ...currentDraft, selected: registered.nickname, confirmed: registered.nickname });
        return { ok: true, identity: registered, message: '닉네임을 등록했어요. 이번 주 아이디를 기억하고 입력칸에 적어 입장해 주세요.' };
      } catch (error) { return failure(`닉네임을 등록하지 못했어요. ${error.message || ''}`); }
    }
    async function login(value, entered, pin) {
      const epoch = ++identityEpoch;
      authenticated = null; sessionPin = null;
      if (!validPin(pin)) return failure('PIN은 숫자 6자리로 입력해 주세요.');
      if (Date.now() < retryAfter) return failure('PIN을 여러 번 틀렸어요. 30초 뒤 다시 시도해 주세요.');
      const classroom = classroomFrom(value), nickname = clean(entered), weekId = getWeek(clock()).id;
      if (!classroom || !nicknameValid(nickname)) return failure('학교와 반을 확인하고 확정한 닉네임을 정확히 입력해 주세요.');
      const identity = { weekId, playerId: playerIdFor(classroom, nickname), nickname, classroom };
      try {
        const remote = await deadline(provider(), timeout, '온라인 연결을 확인하지 못했어요. 다시 시도해 주세요.');
        if (epoch !== identityEpoch) return failure('입장 정보가 바뀌었어요. 다시 입장해 주세요.');
        if (getWeek(clock()).id !== weekId) return failure(expiredMessage);
        const registered = identityFrom(await deadline(remote.login(identity, pin), timeout, '닉네임 확인 시간이 초과됐어요. 다시 입장해 주세요.'));
        if (epoch !== identityEpoch) return failure('입장 정보가 바뀌었어요. 다시 입장해 주세요.');
        if (getWeek(clock()).id !== weekId) return failure(expiredMessage);
        if (!registered || registered.playerId !== identity.playerId || registered.weekId !== weekId) return failure('이번 주에 등록된 닉네임을 찾지 못했어요. 학교, 반과 닉네임을 확인해 주세요.');
        write(KEYS.identity, { version: 1, identity: registered });
        authenticated = registered; sessionPin = pin; failedLogins = 0;
        return { ok: true, identity: registered, message: `${nickname}, 전국학급랭킹전에 입장했어요.` };
      } catch (error) { if (++failedLogins >= 5) { retryAfter = Date.now() + 30000; failedLogins = 0; } return failure(`입장하지 못했어요. ${error.message || ''}`); }
    }
    async function submit(record) {
      const identity = identityFrom(record?.competition), weekId = getWeek(clock()).id;
      const difficulty = record?.settings?.difficulty;
      const max = Object.hasOwn(scoreMax, difficulty) && ([2, 3].includes(record.scoringVersion)
        ? root.LearningGame.maxAnswerScore(record.settings, record.scoringVersion === 3) : record.scoringVersion == null ? scoreMax[difficulty] : 0);
      if (!record || record.completed !== true || record.rankingEnabled !== true || record.rankingMode === 'demo' || !identity
        || typeof record.id !== 'string' || !record.id || record.id.length > 160 || !integer(record.total, 200) || record.total < 5
        || !integer(record.correct, record.total) || !integer(record.firstCorrect, record.correct)
        || !max || !integer(record.score, record.total * max) || typeof record.date !== 'string' || !Number.isFinite(Date.parse(record.date))) return failure('5문제 이상을 끝까지 마친 이번 주 랭킹전 학습만 반영할 수 있어요.');
      if (identity.weekId !== weekId || getWeek(record.date).id !== weekId) return failure(expiredMessage);
      if (getIdentity()?.playerId !== identity.playerId) return failure('이 기록의 닉네임과 PIN으로 다시 입장한 뒤 반영해 주세요.');
      if ((record.scoringVersion === 3 || record.settings.grade != null) && record.settings.grade !== identity.classroom.grade) return failure('우리 반 학년의 문제만 랭킹에 반영할 수 있어요.');
      try {
        const remote = await deadline(provider(), timeout, '온라인 연결을 확인하지 못했어요. 기록에서 다시 시도할 수 있어요.');
        if (getWeek(clock()).id !== weekId) return failure(expiredMessage);
        const result = await deadline(remote.contribute({ identity, pin: sessionPin, sessionId: record.id, score: record.score, total: record.total, firstCorrect: record.firstCorrect, date: record.date, difficulty }), timeout,
          '반영 결과를 아직 확인하지 못했어요. 기록에서 다시 시도해도 점수는 한 번만 반영돼요.');
        return { ok: true, duplicate: result.duplicate === true, message: result.duplicate ? '이미 학급과 개인 점수에 반영한 학습이에요.' : `학급과 개인 주간 점수에 각각 ${record.score}점을 더했어요.` };
      } catch (error) { return failure(`온라인 점수 반영 결과를 확인하지 못했어요. 기록에서 다시 시도할 수 있어요. ${error.message || ''}`); }
    }
    function watchRankings({ week = 'current', kind = 'class' } = {}, onData, onError = () => {}) {
      let active = true, unsubscribe = null, timer = null, revision = 0;
      week = week === 'prev' ? 'prev' : 'current'; kind = kind === 'individual' ? 'individual' : 'class';
      const fail = error => { if (active) onError(error instanceof Error ? error : new Error(String(error))); };
      async function connect() {
        const ownRevision = ++revision;
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        const current = getWeek(clock()), weekId = week === 'prev' ? current.prevId : current.id;
        const identity = getSavedIdentity(), ownId = kind === 'class' ? identity?.classroom.id || null : identity?.weekId === weekId ? identity.playerId : null;
        try {
          const remote = await deadline(provider(), timeout, '랭킹 연결 시간이 초과됐어요. 다시 시도해 주세요.');
          if (!active || revision !== ownRevision) return;
          if (getWeek(clock()).id !== current.id) { connect(); return; }
          const close = remote.watch({ weekId, kind, ownId }, data => {
            if (!active || revision !== ownRevision) return;
            const normalize = row => {
              if (!row || typeof row.id !== 'string' || !integer(row.score) || !integer(row.sessions)) return null;
              if (kind === 'individual') { const person = identityFrom(row); return person && person.weekId === weekId ? { id: row.id, nickname: person.nickname, classroom: person.classroom, score: row.score, sessions: row.sessions } : null; }
              const classroom = classroomFrom(row); return classroom ? { ...classroom, id: row.id, score: row.score, sessions: row.sessions } : null;
            };
            const rows = (Array.isArray(data.rows) ? data.rows : []).map(normalize).filter(Boolean).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 50);
            onData({ rows, own: rows.find(row => row.id === ownId) || normalize(data.own), weekId });
          }, error => { if (revision === ownRevision) fail(error); });
          if (active && revision === ownRevision) unsubscribe = close; else close();
        } catch (error) { if (revision === ownRevision) fail(error); }
        if (active && revision === ownRevision) timer = schedule(connect, Math.max(1, current.endMs - new Date(clock()).getTime()));
      }
      connect();
      return () => { active = false; revision++; if (unsubscribe) unsubscribe(); if (timer !== null) cancel(timer); };
    }
    return Object.freeze({ getWeek: now => getWeek(now === undefined ? clock() : now), getIdentity, getSavedIdentity, clearIdentity, cancelPendingLogin, getDraft, rollNickname, startNewDraft, registerNickname, login, submit, watchRankings });
  }
  const api = Object.freeze({ ...createRepository(), createRepository, createFirestoreProvider, keys: KEYS });
  root.WeeklyCompetition = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
