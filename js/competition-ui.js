/* Weekly competition views. Network work starts only when a view is opened. */
(function (root) {
  'use strict';
  function create({ esc: E, button, notify, onChange, onEnter }) {
    const ranking = root.ClassRanking, competition = root.WeeklyCompetition;
    const state = {
      screen: '', weekId: competition.getWeek().id, classroom: null,
      school: null, grade: 4, className: '1', query: '', schools: null,
      searching: false, searchError: '', nickname: '', candidate: '', busy: '', message: '', error: false,
      kind: 'class', boards: { current: null, prev: null }, boardErrors: {}
    };
    let authRequest = 0, schoolRequest = 0, boardRequest = 0, weekTimer = null;
    let subscriptions = [];
    const number = value => Number(value || 0).toLocaleString('ko-KR');
    const classLabel = value => value ? `${value.schoolName} ${value.grade}학년 ${value.className}반` : '';
    const option = (value, label, selected) => `<option value="${E(value)}"${String(value) === String(selected) ? ' selected' : ''}>${E(label)}</option>`;
    const contextKey = () => `${state.classroom?.id || ''}:${competition.getWeek().id}`;
    const sameClass = identity => !!(identity && state.classroom && identity.classroom?.id === state.classroom.id);
    const draft = () => state.classroom ? competition.getDraft(state.classroom) : null;
    function message(text, error = false) { state.message = text || ''; state.error = error; }
    function invalidateEntry() {
      authRequest++;
      competition.cancelPendingLogin();
      state.busy = ''; state.nickname = ''; state.candidate = ''; message('');
    }
    function stopBoards() {
      boardRequest++;
      subscriptions.forEach(unsubscribe => unsubscribe());
      subscriptions = [];
    }
    function watchBoards() {
      stopBoards();
      state.boards = { current: null, prev: null }; state.boardErrors = {};
      const request = boardRequest, kind = state.kind;
      for (const week of ['current', 'prev']) {
        try {
          const unsubscribe = competition.watchRankings({ week, kind }, data => {
            if (request !== boardRequest || state.screen !== 'board') return;
            state.boards[week] = data; delete state.boardErrors[week]; onChange();
          }, error => {
            if (request !== boardRequest || state.screen !== 'board') return;
            state.boardErrors[week] = error?.message || '랭킹을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
            onChange();
          });
          if (typeof unsubscribe === 'function') subscriptions.push(unsubscribe);
        } catch (error) {
          state.boardErrors[week] = error.message || '랭킹 연결을 시작하지 못했어요.';
        }
      }
    }
    function checkWeek() {
      const week = competition.getWeek();
      if (week.id !== state.weekId) {
        state.weekId = week.id; invalidateEntry();
        if (state.screen === 'board') watchBoards();
        else message('새 주간이 시작되었어요. 이번 주에 사용할 닉네임을 발급받아 주세요.');
        onChange();
      }
      if (state.screen) {
        root.clearTimeout(weekTimer);
        weekTimer = root.setTimeout(checkWeek, Math.max(50, Math.min(60000, week.endMs - Date.now() + 25)));
      }
    }
    function leave() {
      state.screen = ''; schoolRequest++; invalidateEntry(); stopBoards();
      state.searching = false;
      root.clearTimeout(weekTimer); weekTimer = null;
    }
    function openEntry() {
      leave(); state.screen = 'entry'; state.weekId = competition.getWeek().id;
      state.classroom = ranking.getSelection(); state.school = state.classroom;
      state.grade = state.classroom?.grade || 4; state.className = state.classroom?.className || '1';
      state.schools = null; state.searchError = '';
      const identity = competition.getIdentity();
      if (sameClass(identity)) state.nickname = identity.nickname;
      const currentDraft = draft();
      if (!state.nickname && currentDraft?.confirmed) state.nickname = currentDraft.confirmed;
      state.candidate = currentDraft?.selected || currentDraft?.candidates?.at(-1) || '';
      checkWeek(); onChange();
    }
    function openBoard() {
      leave(); state.screen = 'board'; state.weekId = competition.getWeek().id;
      watchBoards(); checkWeek(); onChange();
    }
    function search() {
      if (state.searching) return;
      const query = state.query.trim(), request = ++schoolRequest;
      state.schools = null; state.searchError = '';
      if (query.length < 2) {
        state.searchError = '학교 이름이나 지역을 두 글자 이상 입력해 주세요.'; onChange(); return;
      }
      state.searching = true; onChange();
      Promise.resolve().then(() => ranking.searchSchools(query)).then(schools => {
        if (request !== schoolRequest || state.screen !== 'entry') return;
        state.schools = schools; state.searching = false; onChange();
      }).catch(error => {
        if (request !== schoolRequest || state.screen !== 'entry') return;
        state.searchError = error.message || '학교를 찾지 못했어요. 다시 검색해 주세요.';
        state.searching = false; onChange();
      });
    }
    function chooseClass() {
      if (!state.school) return;
      const result = ranking.selectClass({ ...state.school, grade: state.grade, className: state.className });
      if (!result.ok) { message(result.message, true); onChange(); return; }
      invalidateEntry(); state.classroom = ranking.getSelection();
      const identity = competition.getIdentity();
      if (sameClass(identity)) state.nickname = identity.nickname;
      const currentDraft = draft();
      if (!state.nickname && currentDraft?.confirmed) state.nickname = currentDraft.confirmed;
      state.candidate = currentDraft?.selected || currentDraft?.candidates?.at(-1) || '';
      message('우리 반을 선택했어요. 닉네임을 준비해 주세요.'); onChange();
    }
    function authenticate(type) {
      if (state.busy || !state.classroom) return;
      const nickname = (type === 'register' ? state.candidate : state.nickname).trim();
      if (!nickname) { message('사용할 닉네임을 먼저 골라 주세요.', true); onChange(); return; }
      const key = contextKey(), classroom = { ...state.classroom }, request = ++authRequest;
      state.busy = type; message(''); onChange();
      Promise.resolve().then(() => type === 'register'
        ? competition.registerNickname(classroom, nickname) : competition.login(classroom, nickname))
        .then(result => {
          if (request !== authRequest || key !== contextKey() || state.screen !== 'entry') return;
          state.busy = '';
          if (!result.ok) { message(result.message || '닉네임을 확인하지 못했어요. 다시 시도해 주세요.', true); onChange(); return; }
          state.nickname = result.identity.nickname;
          if (type === 'register') {
            message(`“${result.identity.nickname}” 등록 완료! 이번 주 아이디를 기억하고 입장해 주세요.`);
            onChange();
          } else { onEnter(result.identity); }
        }).catch(error => {
          if (request !== authRequest || key !== contextKey() || state.screen !== 'entry') return;
          state.busy = ''; message(error.message || '연결하지 못했어요. 인터넷 연결을 확인해 주세요.', true); onChange();
        });
    }
    function entryHtml() {
      const currentDraft = draft(), identity = competition.getIdentity();
      const candidates = currentDraft?.candidates || [], rolls = currentDraft?.rolls || 0;
      const registered = !!currentDraft?.confirmed, disabled = state.busy ? 'disabled' : '';
      const chosen = state.classroom;
      const saved = competition.getSavedIdentity();
      return `<section class="competition-page" aria-labelledby="competition-entry-title"><span class="eyebrow">개인 학습 · 우리 반과 함께</span><h1 id="competition-entry-title">전국학급랭킹전</h1><p class="competition-intro">나의 배움이 우리 반 점수로! 학교와 반을 선택하고 나만의 닉네임으로 시작해요.</p><p class="competition-week-note">매주 월요일 오전 8시(한국 시간)에 새 주간이 시작돼요. 학급 점수와 개인 점수를 함께 모아요.</p><div class="competition-entry-grid"><section class="competition-card" aria-labelledby="competition-class-title"><h2 id="competition-class-title"><span class="competition-step">1</span> 우리 반 선택</h2><label class="field-label" for="competition-school-query">학교 이름 또는 지역</label><div class="ranking-search"><input id="competition-school-query" type="search" value="${E(state.query)}" maxlength="100" autocomplete="off" placeholder="학교 이름 두 글자 이상" aria-describedby="competition-search-status">${button('competition-search', state.searching ? '검색 중…' : '학교 검색', '', '', state.searching ? 'disabled' : '')}</div><div id="competition-search-status" role="status">${state.searchError ? `<p class="ranking-note ranking-error">${E(state.searchError)}</p>` : state.searching ? '<p class="ranking-note">학교를 찾고 있어요.</p>' : state.schools ? `<p class="ranking-note">${state.schools.length ? `${state.schools.length}개 학교를 찾았어요.${state.schools.length === 50 ? ' 지역을 함께 입력하면 더 쉽게 찾을 수 있어요.' : ''}` : '검색 결과가 없어요. 학교 이름이나 지역을 바꿔 검색해 주세요.'}</p>` : ''}</div>${state.schools?.length ? `<ul class="ranking-schools" aria-label="학교 검색 결과">${state.schools.map((school, i) => `<li>${button('competition-school-pick', `<strong>${E(school.schoolName)}</strong><small>${E(school.address || school.region)}</small>`, `ranking-school${state.school?.schoolName === school.schoolName && state.school?.region === school.region ? ' selected' : ''}`, '', `data-value="${i}"`)}</li>`).join('')}</ul>` : ''}${state.school ? `<p class="ranking-chosen"><b>${E(state.school.schoolName)}</b><br>${E(state.school.region)}</p>` : '<p class="ranking-note">검색 결과에서 나의 학교를 눌러 주세요.</p>'}<div class="ranking-class-fields"><label for="competition-grade">학년<select id="competition-grade" data-competition-field="grade">${[4, 5, 6].map(value => option(value, `${value}학년`, state.grade)).join('')}</select></label><label for="competition-class">반<select id="competition-class" data-competition-field="className">${Array.from({ length: 30 }, (_, i) => option(i + 1, `${i + 1}반`, state.className)).join('')}</select></label>${button('competition-class-select', '우리 반 선택', 'btn-primary', '', state.school ? '' : 'disabled')}</div>${chosen ? `<div class="competition-selected"><span class="pill">선택 완료</span><strong>${E(classLabel(chosen))}</strong></div>` : ''}</section><section class="competition-card" aria-labelledby="competition-nickname-title"><h2 id="competition-nickname-title"><span class="competition-step">2</span> 이번 주 나의 닉네임</h2>${chosen ? `${sameClass(identity) ? `<p class="competition-selected"><span class="pill">이번 주 아이디</span><strong>${E(identity.nickname)}</strong></p>` : ''}<p class="ranking-note">주사위를 굴려 마음에 드는 이름을 골라요. 최대 10번 중 나온 이름을 선택하고 확정하면 등록돼요.</p><div class="competition-dice-actions">${button('competition-roll', registered ? '닉네임 등록 완료' : '⚄ 닉네임 주사위', 'btn-gold', '', disabled || (registered || rolls >= 10 ? 'disabled' : ''))}<span class="competition-roll-count" role="status">${number(rolls)} / 10회</span></div>${candidates.length ? `<div class="competition-candidates" role="group" aria-label="나온 닉네임 선택">${candidates.map((nickname, i) => button('competition-candidate', E(nickname), state.candidate === nickname ? 'btn-primary' : '', '', `data-value="${i}" aria-pressed="${state.candidate === nickname}" ${disabled || (registered ? 'disabled' : '')}`)).join('')}</div>` : '<div class="competition-dice-empty">주사위를 눌러 어떤 친구가 나올지 확인해 봐요.</div>'}${rolls >= 10 && !registered ? '<p class="ranking-note">10번을 모두 굴렸어요. 위에서 마음에 드는 이름을 골라 확정해 주세요.</p>' : ''}${button('competition-confirm', state.busy === 'register' ? '등록 중…' : '이 닉네임으로 확정', 'btn-primary competition-wide', '', disabled || (!state.candidate || registered ? 'disabled' : ''))}<div class="competition-login"><label class="field-label" for="competition-nickname">이번 주에 등록한 닉네임</label><input id="competition-nickname" value="${E(state.nickname)}" maxlength="40" autocomplete="off" spellcheck="false" placeholder="등록한 닉네임을 입력하세요" ${disabled} aria-describedby="competition-nickname-help"><p id="competition-nickname-help" class="ranking-note">확정한 닉네임이 이번 주 나의 아이디예요. 다른 기기에서도 같은 학교·학년·반과 닉네임으로 입장할 수 있어요.</p>${button('competition-enter', state.busy === 'login' ? '입장 중…' : '랭킹전 입장', 'btn-dark competition-wide', '', disabled)}</div>${registered ? button('competition-new-draft', '닉네임을 잊었어요 · 새로 발급받기', 'btn-quiet competition-wide', '', disabled) : ''}${saved && saved.weekId !== state.weekId ? '<p class="ranking-note">지난주 닉네임은 사용 기간이 끝났어요. 이번 주 닉네임을 새로 등록해 주세요.</p>' : ''}` : '<div class="competition-dice-empty">먼저 학교와 학년, 반을 선택해 주세요.</div>'}<div class="competition-entry-message${state.error ? ' ranking-error' : ''}" role="status" aria-live="polite">${E(state.message)}</div></section></div></section>`;
    }
    function row(value, position, own) {
      const ours = own?.id === value.id;
      const title = state.kind === 'class' ? classLabel(value) : value.nickname;
      const subtitle = state.kind === 'class' ? value.region : classLabel(value.classroom);
      return `<li class="competition-rank-row${ours ? ' competition-rank-own' : ''}"><span class="competition-position">${position === null ? '목록 밖' : number(position)}</span><span class="competition-rank-name"><strong>${E(title)}</strong><small>${E(subtitle || '')}${ours ? (state.kind === 'class' ? ' · 우리 반' : ' · 나') : ''}</small></span><span class="competition-rank-score">${number(value.score)}<small>점</small></span></li>`;
    }
    function board(week) {
      const data = state.boards[week], error = state.boardErrors[week], previous = week === 'prev';
      const label = previous ? '지난주 결과' : '이번 주 실시간', rows = data?.rows || [], own = data?.own;
      const outside = own && !rows.some(value => value.id === own.id);
      const id = previous ? competition.getWeek().prevId : state.weekId;
      const date = `${id.slice(0, 4)}.${id.slice(4, 6)}.${id.slice(6, 8)}`;
      return `<section class="competition-card competition-board" aria-labelledby="competition-${week}-title"><div class="competition-board-heading"><h2 id="competition-${week}-title">${label}</h2><span class="pill">${previous ? '지난주 누적' : '실시간'}</span></div><p class="ranking-note">${date} 월요일 오전 8시부터 일주일 · ${state.kind === 'class' ? '학급' : '개인'} 상위 50위</p>${error ? `<div class="ranking-empty ranking-error" role="status"><p>${E(error)}</p>${button('competition-refresh', '다시 연결', 'btn-primary')}</div>` : !data ? '<div class="ranking-empty" role="status"><p>랭킹을 불러오고 있어요.</p></div>' : rows.length || outside ? `<ol class="competition-rank-list" aria-label="${label} ${state.kind === 'class' ? '학급' : '개인'} 랭킹">${rows.map((value, i) => row(value, i + 1, own)).join('')}${outside ? row(own, null, own) : ''}</ol>${outside ? '<p class="ranking-note">상위 50위 목록 밖의 기록이에요. 정확한 순위는 제공되지 않아요.</p>' : ''}` : `<div class="ranking-empty"><h3>${previous ? '지난주 기록이 없어요' : '아직 기록이 없어요'}</h3><p>${previous ? '학습이 완료된 주간의 결과가 여기에 남아요.' : '문제를 풀고 첫 점수를 쌓아 보세요.'}</p></div>`}</section>`;
    }
    function boardHtml() {
      return `<section class="competition-page" aria-labelledby="competition-ranking-title"><span class="eyebrow">매주 함께 쌓는 배움</span><h1 id="competition-ranking-title">학급·개인 랭킹</h1><p class="competition-intro">이번 주 실시간 점수와 지난주 결과를 함께 확인해요.</p><p class="competition-week-note">월요일 오전 8시(한국 시간)에 새 주간이 시작돼요. 지난주 누적 결과는 다음 월요일까지 함께 보여요.</p><div class="competition-board-tools"><div class="ranking-tabs" role="group" aria-label="랭킹 종류">${button('competition-kind', '학급 랭킹', state.kind === 'class' ? 'btn-primary' : '', '', `data-value="class" aria-pressed="${state.kind === 'class'}"`)}${button('competition-kind', '개인 랭킹', state.kind === 'individual' ? 'btn-primary' : '', '', `data-value="individual" aria-pressed="${state.kind === 'individual'}"`)}</div>${button('competition-refresh', '새로고침', 'btn-small', 'refresh')}</div><div class="competition-boards">${board('current')}${board('prev')}</div><p class="competition-legacy-link">${button('legacy-ranking', '이전 방식의 랭킹 기록', 'btn-small btn-quiet')}</p></section>`;
    }
    function action(name, value) {
      if (name === 'competition-search') { search(); return true; }
      if (name === 'competition-school-pick') {
        if (/^\d+$/.test(String(value)) && state.schools?.[Number(value)]) {
          invalidateEntry(); state.school = state.schools[Number(value)]; state.classroom = null; onChange();
        }
        return true;
      }
      if (name === 'competition-class-select') { chooseClass(); return true; }
      if (name === 'competition-roll') {
        if (state.classroom && !state.busy) {
          const result = competition.rollNickname(state.classroom);
          if (result.ok) state.candidate = result.draft.selected || result.draft.candidates.at(-1) || '';
          message(result.message, !result.ok); onChange();
        }
        return true;
      }
      if (name === 'competition-candidate') {
        const currentDraft = draft();
        if (!state.busy && !currentDraft?.confirmed && /^\d+$/.test(String(value)) && currentDraft?.candidates[Number(value)]) {
          state.candidate = currentDraft.candidates[Number(value)]; onChange();
        }
        return true;
      }
      if (name === 'competition-confirm') { if (!draft()?.confirmed) authenticate('register'); return true; }
      if (name === 'competition-enter') { authenticate('login'); return true; }
      if (name === 'competition-new-draft') {
        if (!state.busy && state.classroom && draft()?.confirmed) {
          const result = competition.startNewDraft(state.classroom);
          if (result.ok) invalidateEntry();
          message(result.message || '새 닉네임을 발급받아 주세요. 이전 닉네임의 점수는 그대로 남아요.', !result.ok); onChange();
        }
        return true;
      }
      if (name === 'competition-kind') {
        if (['class', 'individual'].includes(value) && state.kind !== value) { state.kind = value; watchBoards(); onChange(); }
        return true;
      }
      if (name === 'competition-refresh') { if (state.screen === 'board') { watchBoards(); onChange(); } return true; }
      return false;
    }
    function input(event) {
      if (event.target.id === 'competition-school-query') { state.query = event.target.value; return true; }
      if (event.target.id === 'competition-nickname') { state.nickname = event.target.value; return true; }
      return false;
    }
    function change(event) {
      if (input(event)) return true;
      const field = event.target.dataset?.competitionField;
      if (field === 'grade' || field === 'className') {
        const value = event.target.value;
        if (field === 'grade' && !['4', '5', '6'].includes(value)) return true;
        if (field === 'className' && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 30)) return true;
        state[field] = field === 'grade' ? Number(value) : value;
        invalidateEntry(); state.classroom = null; onChange(); return true;
      }
      return false;
    }
    return Object.freeze({ entryHtml, boardHtml, action, change, input, openEntry, openBoard, leave, destroy: leave });
  }
  root.CompetitionUI = Object.freeze({ create });
})(globalThis);
