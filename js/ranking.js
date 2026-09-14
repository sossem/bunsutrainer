/* Optional class rankings. Loading this file never starts a network request. */
(function (root) {
  'use strict';
  const CLASS_KEY = 'bunsu.class.v1';
  const DEMO_KEY = 'bunsu.ranking.v1';
  const DAY = 86400000;
  const TIMEOUT = 8000;
  const FIREBASE_CONFIG = Object.freeze({
    apiKey: 'AIzaSyDVN-1z6ymvwcjlnqxEWD2FewBTTrJCv0Q',
    authDomain: 'bunsutrainer.firebaseapp.com', projectId: 'bunsutrainer',
    storageBucket: 'bunsutrainer.firebasestorage.app', messagingSenderId: '672244886396',
    appId: '1:672244886396:web:ed7a7620353d55001812f9', measurementId: 'G-56MTL6V1D9'
  });

  function getWeekIds(now = new Date()) {
    const time = new Date(now).getTime();
    if (!Number.isFinite(time)) throw new RangeError('학습 날짜를 확인해 주세요.');
    const shifted = time + 9 * 3600000;
    const day = new Date(shifted).getUTCDay();
    const monday = shifted - (day === 0 ? 6 : day - 1) * DAY;
    const format = value => new Date(value).toISOString().slice(0, 10).replace(/-/g, '');
    return { current: format(monday), prev: format(monday - 7 * DAY) };
  }
  const copy = value => JSON.parse(JSON.stringify(value));
  const text = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const count = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
  const compareRows = (a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  function selectionFrom(value) {
    if (!value || typeof value !== 'object') return null;
    const schoolName = text(value.schoolName), region = text(value.region);
    const gradeText = String(value.grade ?? ''), classText = String(value.className ?? '');
    if (!schoolName || schoolName.length > 100 || !region || region.length > 80 || /[\/\x00-\x1f]/.test(schoolName + region)) return null;
    if (!/^\d+$/.test(gradeText) || !/^\d+$/.test(classText)) return null;
    const grade = Number(gradeText), classNumber = Number(classText);
    if (grade < 4 || grade > 6 || classNumber < 1 || classNumber > 30) return null;
    const className = String(classNumber);
    return { schoolName, region, grade, className, id: `[${region}] ${schoolName} ${grade}학년 ${className}반` };
  }
  function normalizeRow(raw, mode) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
    let schoolName = text(raw.schoolName).slice(0, 150), region = text(raw.region).slice(0, 100);
    if (mode === 'legacy') {
      const match = schoolName.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (match) { region = region || match[1]; schoolName = match[2]; }
    }
    if (!schoolName) return null;
    return {
      id: raw.id, schoolName, region, grade: count(raw.grade),
      className: String(raw.className ?? raw.classNum ?? ''), score: count(raw.score),
      totalSolved: count(raw.totalSolved), correctCount: count(raw.correctCount),
      sessions: count(raw.sessions ?? raw.playCount), isDemo: mode === 'demo'
    };
  }
  function withTimeout(promise, message, milliseconds = TIMEOUT) {
    let timer;
    return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]).finally(() => clearTimeout(timer));
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (!root.document?.head) { reject(new Error('온라인 랭킹은 웹 브라우저에서 열어 주세요.')); return; }
      const script = root.document.createElement('script');
      let timer;
      const finish = error => {
        clearTimeout(timer); script.onload = null; script.onerror = null;
        if (error) { script.remove(); reject(error); } else resolve();
      };
      timer = setTimeout(() => finish(new Error('온라인 랭킹 연결 시간이 초과되었어요. 다시 시도해 주세요.')), TIMEOUT);
      script.src = src; script.async = true;
      script.onload = () => finish();
      script.onerror = () => finish(new Error('온라인 랭킹 연결 파일을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'));
      root.document.head.appendChild(script);
    });
  }
  let defaultProviderPromise;
  async function defaultProvider() {
    if (!defaultProviderPromise) defaultProviderPromise = (async () => {
      if (!root.firebase?.initializeApp) await loadScript('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
      if (!root.firebase?.firestore) await loadScript('https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js');
      const name = 'fraction-class-ranking';
      const app = root.firebase.apps.find(item => item.name === name) || root.firebase.initializeApp(FIREBASE_CONFIG, name);
      return createFirestoreProvider(app.firestore());
    })().catch(error => { defaultProviderPromise = null; throw error; });
    return defaultProviderPromise;
  }

  /* All transaction reads precede writes. The receipt makes network retries safe. */
  function createFirestoreProvider(db) {
    return Object.freeze({
      getDatabase: () => db,
      async read({ collection, limit = 50, classId = null }) {
        const reference = db.collection(collection);
        const snapshot = await reference.orderBy('score', 'desc').limit(limit).get();
        const rows = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        let ourClass = rows.find(row => row.id === classId) || null;
        if (classId && !ourClass) {
          const own = await reference.doc(classId).get();
          if (own.exists) ourClass = { ...own.data(), id: own.id };
        }
        return { rows, ourClass };
      },
      async contribute(payload) {
        const classRef = db.collection(payload.collection).doc(payload.classId);
        const receiptRef = db.collection(payload.receipts).doc(payload.receiptId);
        return db.runTransaction(async transaction => {
          const receipt = await transaction.get(receiptRef);
          if (receipt.exists) return { duplicate: true };
          const previous = await transaction.get(classRef);
          const old = previous.exists ? previous.data() : {};
          const row = {
            ...payload.selection, scoreVersion: 2,
            score: count(old.score) + payload.contribution,
            totalSolved: count(old.totalSolved) + payload.totalSolved,
            correctCount: count(old.correctCount) + payload.correctCount,
            sessions: count(old.sessions) + 1, updatedAt: payload.date
          };
          if (![row.score, row.totalSolved, row.correctCount, row.sessions].every(Number.isSafeInteger)) throw new Error('학급 누적 기록의 범위를 확인해 주세요.');
          transaction.set(classRef, row, { merge: true });
          transaction.set(receiptRef, {
            sessionId: payload.sessionId, classId: payload.classId, contribution: payload.contribution,
            totalSolved: payload.totalSolved, correctCount: payload.correctCount,
            completedAt: payload.date, scoreVersion: 2
          });
          return { duplicate: false };
        });
      }
    });
  }

  function createRepository(options = {}) {
    const clock = options.clock || (() => new Date());
    const network = options.onlineProvider || defaultProvider;
    const fetcher = options.fetch || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    const memory = new Map(), blockedKeys = new Set();
    let storage, warning = '', schoolPromise;
    try { storage = Object.prototype.hasOwnProperty.call(options, 'storage') ? options.storage : root.localStorage; }
    catch (_) { storage = null; }
    const storageWarning = () => { warning = '기기 저장을 사용할 수 없어 선택과 데모 기록은 현재 창에만 보관해요.'; };
    function read(key, fallback) {
      let value = memory.get(key);
      if (!blockedKeys.has(key)) {
        try { if (!storage) throw new Error(); value = storage.getItem(key); }
        catch (_) { blockedKeys.add(key); storageWarning(); }
      }
      if (!value) return copy(fallback);
      try {
        const parsed = JSON.parse(value);
        if (!parsed || parsed.version !== 1) throw new Error();
        memory.set(key, value); return parsed;
      } catch (_) {
        blockedKeys.add(key); storageWarning(); return copy(fallback);
      }
    }
    function write(key, value) {
      const serialized = JSON.stringify(value); memory.set(key, serialized);
      try {
        if (!storage || blockedKeys.has(key)) throw new Error();
        storage.setItem(key, serialized);
      } catch (_) { blockedKeys.add(key); storageWarning(); }
    }
    function getSelection() { return selectionFrom(read(CLASS_KEY, { version: 1, selection: null }).selection); }
    function selectClass(value) {
      const selection = selectionFrom(value);
      if (!selection) return { ok: false, selection: null, message: '학교와 지역을 선택하고, 4–6학년·1–30반을 입력해 주세요.' };
      write(CLASS_KEY, { version: 1, selection });
      return { ok: true, selection: copy(selection), message: warning || '우리 반을 선택했어요.' };
    }
    function clearSelection() {
      memory.delete(CLASS_KEY);
      try { if (!storage) throw new Error(); storage.removeItem(CLASS_KEY); }
      catch (_) { blockedKeys.add(CLASS_KEY); storageWarning(); }
      return { ok: true, message: warning || '우리 반 선택을 해제했어요.' };
    }
    async function searchSchools(query) {
      const clean = text(query);
      if (!clean) return [];
      if (!schoolPromise) schoolPromise = (async () => {
        if (!fetcher) throw new Error('학교 검색은 웹 주소로 접속한 뒤 사용할 수 있어요.');
        const response = await withTimeout(fetcher('elementaryschooldata.json'), '학교 목록을 불러오는 시간이 초과되었어요.');
        if (!response.ok) throw new Error('학교 목록을 불러오지 못했어요. 인터넷 연결과 파일 경로를 확인해 주세요.');
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('학교 목록의 형식을 확인해 주세요.');
        return data.filter(item => item && text(item['학교명'])).map(item => {
          const address = text(item['도로명주소']);
          return { schoolName: text(item['학교명']), region: [text(item['시도명']), address.split(' ')[1]].filter(Boolean).join(' '), address };
        });
      })().catch(error => { schoolPromise = null; throw new Error(`학교 검색을 사용할 수 없어요. 웹 주소로 접속하거나 다시 시도해 주세요. ${error.message || ''}`); });
      return (await schoolPromise).filter(school => `${school.schoolName} ${school.region}`.includes(clean)).slice(0, 50).map(copy);
    }
    function demoState() {
      const data = read(DEMO_KEY, { version: 1, weeks: {} });
      if (!data.weeks || typeof data.weeks !== 'object' || Array.isArray(data.weeks)) return { version: 1, weeks: {} };
      return data;
    }
    function demoSamples(week) {
      const previous = week === 'prev';
      return ['새봄', '배움', '함께', '나래', '햇살'].map((name, index) => ({
        id: `demo-sample-${index + 1}`, schoolName: `${name}초등학교 (예시)`, region: '가상 지역',
        grade: 4 + index % 3, className: String(index % 2 + 1),
        score: (previous ? 340 : 420) - index * 62,
        totalSolved: 30 - index * 3, correctCount: 25 - index * 3, sessions: 3, isDemo: true
      }));
    }
    const provider = async () => typeof network === 'function' ? network() : network;
    async function getRankingData({ mode = 'online', week = 'current' } = {}) {
      if (!['online', 'demo', 'legacy'].includes(mode)) mode = 'online';
      week = week === 'prev' ? 'prev' : 'current';
      const weekId = getWeekIds(clock())[week], selection = getSelection();
      const base = { mode, rows: [], ourClass: null, ourRank: null, totalClasses: null, limited: mode !== 'demo', message: '', ok: true };
      if (mode === 'demo') {
        const local = demoState().weeks[weekId];
        const saved = local?.rows && typeof local.rows === 'object' ? Object.values(local.rows) : [];
        const rows = [...demoSamples(week), ...saved.map(row => normalizeRow(row, 'demo')).filter(Boolean)].sort(compareRows);
        const index = selection ? rows.findIndex(row => row.id === selection.id) : -1;
        return { ...base, rows, ourClass: index >= 0 ? rows[index] : null, ourRank: index >= 0 ? index + 1 : null, totalClasses: rows.length, message: `예시 학급과 이 기기의 데모 기록만 보여요. 온라인 점수에는 반영되지 않아요.${warning ? ` ${warning}` : ''}` };
      }
      try {
        const remote = await provider();
        const data = await withTimeout(remote.read({ collection: `${mode === 'legacy' ? 'classRankings' : 'classGrowthRankings'}_${weekId}`, limit: 50, classId: selection?.id || null }), '랭킹 조회 시간이 초과되었어요. 다시 시도해 주세요.');
        const rows = (Array.isArray(data.rows) ? data.rows : []).map(row => normalizeRow(row, mode)).filter(Boolean).sort(compareRows).slice(0, 50);
        const index = selection ? rows.findIndex(row => row.id === selection.id) : -1;
        const own = normalizeRow(data.ourClass, mode);
        return { ...base, rows, ourClass: index >= 0 ? rows[index] : own, ourRank: index >= 0 ? index + 1 : null,
          message: mode === 'legacy' ? '기존 방식의 과거 점수입니다. 새 성장 점수와 합산하지 않아요. 상위 50개 학급만 조회해요.' : '온라인 상위 50개 학급을 보여요. 목록 밖의 학급은 정확한 순위를 표시하지 않아요.' };
      } catch (error) {
        return { ...base, ok: false, message: `온라인 랭킹을 불러오지 못했어요. 연결 또는 서버 권한을 확인하고 다시 시도해 주세요. 예시를 보려면 데모를 직접 선택해 주세요. ${error.message || ''}` };
      }
    }
    async function updateClassScore(record, { mode = 'online' } = {}) {
      const result = { ok: false, message: '', contribution: 0, duplicate: false, mode };
      const selection = selectionFrom(record?.classroom);
      const valid = record && record.rankingEnabled === true && record.completed === true && selection &&
        typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 160 &&
        Number.isSafeInteger(record.total) && record.total >= 5 && record.total <= 200 &&
        Number.isSafeInteger(record.firstCorrect) && record.firstCorrect >= 0 && record.firstCorrect <= record.total &&
        Number.isSafeInteger(record.classScoreContribution) && record.classScoreContribution >= 0 && record.classScoreContribution <= 100000 &&
        typeof record.date === 'string' && Number.isFinite(Date.parse(record.date));
      if (!valid || !['online', 'demo'].includes(mode)) return { ...result, message: '학급 참여에 동의하고 5문제 이상을 끝까지 마친 학습만 반영할 수 있어요.' };
      const weekId = getWeekIds(record.date).current, receiptId = encodeURIComponent(record.id);
      const state = demoState(), local = state.weeks[weekId];
      if (mode === 'online' && (record.rankingMode === 'demo' || local?.receipts?.[receiptId])) return { ...result, message: '데모 학습 기록은 온라인 랭킹으로 보내지 않아요.' };
      const payload = {
        collection: `classGrowthRankings_${weekId}`, receipts: `classGrowthContributions_${weekId}`,
        receiptId, sessionId: record.id, classId: selection.id, selection,
        contribution: record.classScoreContribution, totalSolved: record.total, correctCount: record.firstCorrect, date: record.date
      };
      if (mode === 'demo') {
        const bucket = state.weeks[weekId] && typeof state.weeks[weekId] === 'object' ? state.weeks[weekId] : { rows: {}, receipts: {} };
        bucket.rows = bucket.rows && typeof bucket.rows === 'object' ? bucket.rows : {};
        bucket.receipts = bucket.receipts && typeof bucket.receipts === 'object' ? bucket.receipts : {};
        if (Object.prototype.hasOwnProperty.call(bucket.receipts, receiptId)) return { ...result, ok: true, duplicate: true, message: '이미 반영한 데모 학습이에요.' };
        const old = bucket.rows[selection.id] || {};
        bucket.rows[selection.id] = { ...selection, score: count(old.score) + payload.contribution, totalSolved: count(old.totalSolved) + record.total, correctCount: count(old.correctCount) + record.firstCorrect, sessions: count(old.sessions) + 1, isDemo: true };
        Object.defineProperty(bucket.receipts, receiptId, { value: { classId: selection.id, contribution: payload.contribution }, enumerable: true, writable: true, configurable: true });
        state.weeks[weekId] = bucket; write(DEMO_KEY, state);
        return { ...result, ok: true, contribution: payload.contribution, message: `데모 성장 점수에 ${payload.contribution}점을 더했어요. 온라인에는 반영하지 않았어요.${warning ? ` ${warning}` : ''}` };
      }
      try {
        const remote = await provider();
        const saved = await withTimeout(remote.contribute(payload), '반영 결과를 아직 확인할 수 없어요. 같은 학습을 다시 시도해도 한 번만 반영돼요.');
        return { ...result, ok: true, duplicate: saved.duplicate === true, contribution: saved.duplicate ? 0 : payload.contribution,
          message: saved.duplicate ? '이미 반영한 학습이에요. 점수를 다시 더하지 않았어요.' : `우리 반의 성장 점수에 ${payload.contribution}점을 더했어요.` };
      } catch (error) { return { ...result, message: `온라인 반영 결과를 확인하지 못했어요. 기록은 개인 학습에 남아 있으니 다시 시도할 수 있어요. ${error.message || ''}` }; }
    }
    return Object.freeze({ getWeekIds, getSelection, selectClass, clearSelection, searchSchools, getRankingData, updateClassScore });
  }
  const api = Object.freeze({ ...createRepository(), createRepository, createFirestoreProvider, getOnlineProvider: defaultProvider, keys: Object.freeze({ selection: CLASS_KEY, demo: DEMO_KEY }) });
  root.ClassRanking = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
