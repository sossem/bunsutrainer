/* View adapter for ClassRanking. Opening the view does not contact the server. */
(function (root) {
  'use strict';
  function create({ esc: E, button, notify, onChange }) {
    const ranking = root.ClassRanking;
    const selected = ranking.getSelection();
    const state = {
      mode: 'online', week: 'current', status: 'idle', data: null,
      query: '', schools: null, school: null, searching: false, searchError: '',
      grade: selected?.grade || 4, className: selected?.className || '1'
    };
    let rankingRequest = 0, schoolRequest = 0;
    const modes = [{ id: 'online', label: '온라인' }, { id: 'demo', label: '데모' }, { id: 'legacy', label: '예전 점수' }];
    const weeks = [{ id: 'current', label: '이번 주' }, { id: 'prev', label: '지난주' }];
    const classLabel = value => `${value.schoolName} ${value.grade}학년 ${value.className}반`;
    const number = value => Number(value || 0).toLocaleString('ko-KR');
    const option = (value, label, current) => `<option value="${E(value)}"${String(value) === String(current) ? ' selected' : ''}>${E(label)}</option>`;
    function invalidate() {
      rankingRequest++;
      state.data = null;
      state.status = 'idle';
    }
    function load() {
      const request = ++rankingRequest;
      const options = { mode: state.mode, week: state.week };
      state.status = 'loading'; state.data = null; onChange();
      Promise.resolve().then(() => ranking.getRankingData(options)).then(data => {
        if (request !== rankingRequest) return;
        state.data = data; state.status = data.ok ? 'ready' : 'error'; onChange();
      }).catch(error => {
        if (request !== rankingRequest) return;
        state.data = { ok: false, message: `랭킹을 불러오지 못했어요. 다시 시도해 주세요. ${error.message || ''}` };
        state.status = 'error'; onChange();
      });
    }
    function search() {
      state.query = (root.document.getElementById('school-query')?.value ?? state.query).trim();
      const request = ++schoolRequest;
      state.schools = null; state.searchError = ''; state.searching = false;
      if (state.query.length < 2) {
        state.searchError = '학교 이름 또는 지역을 두 글자 이상 입력해 주세요.';
        onChange(); return;
      }
      state.searching = true; onChange();
      const query = state.query;
      Promise.resolve().then(() => ranking.searchSchools(query)).then(schools => {
        if (request !== schoolRequest) return;
        state.schools = schools; state.searching = false; onChange();
      }).catch(error => {
        if (request !== schoolRequest) return;
        state.searchError = error.message || '학교 목록을 불러오지 못했어요. 다시 검색해 주세요.';
        state.searching = false; onChange();
      });
    }
    function registration(selection) {
      return `<section class="ranking-registration" aria-labelledby="class-register-title"><h2 id="class-register-title">우리 반 선택</h2>${selection ? `<div class="ranking-current-class"><span class="pill">현재 선택한 우리 반</span><strong>${E(classLabel(selection))}</strong><span>${E(selection.region)}</span>${button('ranking-clear', '우리 반 선택 해제', 'btn-small btn-quiet')}</div>` : '<p class="ranking-note">학교를 검색하고 학년과 반을 골라 주세요.</p>'}<label class="field-label" for="school-query">학교 이름 또는 지역 (두 글자 이상)</label><div class="ranking-search"><input id="school-query" type="search" value="${E(state.query)}" maxlength="100" autocomplete="off" aria-describedby="school-search-status">${button('ranking-search', state.searching ? '검색 중…' : '학교 검색', '', '', state.searching ? 'disabled' : '')}</div><div id="school-search-status" role="status">${state.searchError ? `<p class="ranking-error">${E(state.searchError)}</p>` : state.searching ? '<p class="ranking-note">학교 목록을 검색하고 있어요.</p>' : state.schools ? `<p class="ranking-note">${state.schools.length ? `${state.schools.length}개 학교가 검색되었어요.${state.schools.length === 50 ? ' 최대 50개까지 보여요. 지역을 함께 입력하면 더 쉽게 찾을 수 있어요.' : ''}` : '검색 결과가 없어요. 학교 이름이나 지역을 바꿔 검색해 주세요.'}</p>` : ''}</div>${state.schools?.length ? `<ul class="ranking-schools" aria-label="학교 검색 결과">${state.schools.map((school, i) => `<li>${button('ranking-school-pick', `<strong>${E(school.schoolName)}</strong><small>${E(school.address || school.region)}</small>`, `ranking-school${state.school?.schoolName === school.schoolName && state.school?.region === school.region ? ' selected' : ''}`, '', `data-value="${i}"`)}</li>`).join('')}</ul>` : ''}${state.school ? `<p class="ranking-chosen"><b>${E(state.school.schoolName)}</b><br>${E(state.school.region)}</p>` : ''}<div class="ranking-class-fields"><label for="ranking-grade">학년<select id="ranking-grade" data-ranking-field="grade">${[4, 5, 6].map(value => option(value, `${value}학년`, state.grade)).join('')}</select></label><label for="ranking-class">반<select id="ranking-class" data-ranking-field="className">${Array.from({ length: 30 }, (_, i) => option(i + 1, `${i + 1}반`, state.className)).join('')}</select></label>${button('ranking-register', '우리 반 선택', 'btn-primary', '', state.school ? '' : 'disabled')}</div><p class="ranking-note">선택은 이 기기에 저장돼요. 이 화면에서는 이전 기록만 조회해요. 새 점수는 홈의 전국학급랭킹전에서 닉네임으로 입장해 쌓을 수 있어요.</p></section>`;
    }
    function row(value, position, selection) {
      const ours = selection?.id === value.id;
      return `<tr${ours ? ' class="ranking-ours"' : ''}><td>${position == null ? '목록 밖' : position <= 3 ? `<span class="rank-medal" role="img" aria-label="${position}위">${['🥇','🥈','🥉'][position-1]}</span>` : number(position)}</td><th scope="row"><strong>${E(classLabel(value))}</strong><small>${E(value.region)}${ours ? ' · 우리 반' : ''}</small></th><td class="ranking-score">${number(value.score)}</td><td>${number(value.sessions)}</td></tr>`;
    }
    function list(selection) {
      if (state.status === 'loading') return '<div class="ranking-empty" role="status"><h3>랭킹을 불러오고 있어요</h3><p>잠시만 기다려 주세요.</p></div>';
      if (state.status === 'idle') return '<div class="ranking-empty"><h3>선택한 랭킹을 조회해 보세요</h3><p>조회 버튼을 누르면 해당 주의 학급 기록을 불러와요.</p></div>';
      if (state.status === 'error') return `<div class="ranking-empty ranking-error" role="status"><h3>랭킹을 불러오지 못했어요</h3><p>${E(state.data.message)}</p>${button('ranking-refresh', '다시 시도', 'btn-primary')}</div>`;
      const data = state.data, rows = data.rows || [];
      const ourClass = data.ourClass?.id === selection?.id ? data.ourClass : null;
      const outside = ourClass && !rows.some(value => value.id === ourClass.id);
      return `<p class="ranking-note" role="status">${E(data.message)}</p>${rows.length || outside ? `<div class="ranking-table-scroll" tabindex="0" role="region" aria-label="학급 랭킹 표"><table class="ranking-table"><caption>${state.mode === 'demo' ? '데모 학급 랭킹' : '상위 50개 학급 랭킹'} · ${state.week === 'prev' ? '지난주' : '이번 주'}</caption><thead><tr><th scope="col">순위</th><th scope="col">학급</th><th scope="col">${state.mode === 'legacy' ? '예전 점수' : '성장 점수'}</th><th scope="col">학습 횟수</th></tr></thead><tbody>${rows.map((value, i) => row(value, i + 1, selection)).join('')}${outside ? row(ourClass, null, selection) : ''}</tbody></table></div>` : '<div class="ranking-empty"><h3>아직 학급 기록이 없어요</h3><p>이번 주 첫 배움을 차근차근 쌓아 보세요.</p></div>'}${selection && !ourClass ? '<p class="ranking-note">선택한 우리 반은 이 주의 기록이 없어요.</p>' : ''}${outside ? '<p class="ranking-note">우리 반은 상위 50개 목록 밖에 있어요. 정확한 순위는 확인할 수 없어요.</p>' : ''}`;
    }
    function render() {
      const selection = ranking.getSelection(), weekId = ranking.getWeekIds()[state.week];
      const weekDate = `${weekId.slice(0, 4)}.${weekId.slice(4, 6)}.${weekId.slice(6, 8)}`;
      return `<section class="ranking-page" aria-labelledby="ranking-title"><span class="eyebrow">함께 쌓는 배움</span><h1 id="ranking-title">이전 방식의 랭킹 기록</h1><p class="ranking-intro">기존 온라인 성장 점수·데모·예전 점수를 조회해요.</p><div class="ranking-layout">${registration(selection)}<section class="ranking-board" aria-labelledby="ranking-board-title"><h2 id="ranking-board-title">학급의 배움 기록</h2><div class="ranking-tabs" role="group" aria-label="랭킹 조회 모드">${modes.map(mode => button('ranking-mode', mode.label, state.mode === mode.id ? 'btn-primary' : '', '', `data-value="${mode.id}" aria-pressed="${state.mode === mode.id}"`)).join('')}</div><p class="ranking-note">여기의 기록은 전국학급랭킹전의 주간 점수와 합산하지 않아요.${state.mode === 'legacy' ? ' 예전 점수는 조회만 하며 성장 점수와 합산하지 않아요.' : state.mode === 'demo' ? ' 데모는 예시와 이 기기의 기록만 보여요.' : ''}</p><div class="ranking-period"><div class="ranking-tabs" role="group" aria-label="조회 주 선택">${weeks.map(week => button('ranking-week', week.label, `btn-small ${state.week === week.id ? 'btn-dark' : ''}`, '', `data-value="${week.id}" aria-pressed="${state.week === week.id}"`)).join('')}</div>${button('ranking-refresh', state.status === 'loading' ? '조회 중…' : '랭킹 조회 / 새로고침', '', 'refresh', state.status === 'loading' ? 'disabled' : '')}</div><p class="ranking-note">${weekDate} 월요일부터 · 한국 시간 기준</p><div class="ranking-content" aria-busy="${state.status === 'loading'}">${list(selection)}</div></section></div></section>`;
    }
    function action(name, value) {
      if (name === 'ranking-refresh') { load(); return true; }
      if (name === 'ranking-mode') {
        if (modes.some(mode => mode.id === value)) { state.mode = value; invalidate(); onChange(); }
        return true;
      }
      if (name === 'ranking-week') {
        if (weeks.some(week => week.id === value)) { state.week = value; invalidate(); onChange(); }
        return true;
      }
      if (name === 'ranking-search') { search(); return true; }
      if (name === 'ranking-school-pick') {
        if (/^\d+$/.test(String(value)) && state.schools?.[Number(value)]) { state.school = state.schools[Number(value)]; onChange(); }
        return true;
      }
      if (name === 'ranking-register') {
        const result = ranking.selectClass({ ...state.school, grade: state.grade, className: state.className });
        if (result.ok) invalidate();
        notify(result.message); onChange(); return true;
      }
      if (name === 'ranking-clear') {
        notify(ranking.clearSelection().message); invalidate(); onChange(); return true;
      }
      return false;
    }
    function change(event) {
      if (event.target.id === 'school-query') { state.query = event.target.value; return true; }
      const field = event.target.dataset?.rankingField;
      if (field === 'grade') { state.grade = Number(event.target.value); return true; }
      if (field === 'className') { state.className = event.target.value; return true; }
      return false;
    }
    return Object.freeze({ render, action, change });
  }
  root.RankingUI = Object.freeze({ create });
})(globalThis);
