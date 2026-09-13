/* Connect optional study tools without changing the fraction engine or layouts. */
(function (root) {
  'use strict';
  function create({ state, button, esc: E, render, notify }) {
    const Game = root.LearningGame, Ranking = root.ClassRanking;
    const active = () => state.view === 'session' && state.session;
    const answer = () => state.session.responses[state.session.index];
    const timer = () => state.session?.timers?.[state.session.index];
    const busy = new Set();
    function pause() { timer()?.pause(); }
    function destroy() { state.session?.timers?.forEach(clock => clock?.destroy()); }
    function updateClock(value) {
      const node = document.querySelector('[data-timer]');
      if (!node) return;
      node.classList.toggle('timer-expired', value.expired);
      node.querySelector('[data-timer-value]').textContent = `${Math.floor(value.remaining / 60)}:${String(value.remaining % 60).padStart(2, '0')}`;
      node.querySelector('[data-timer-state]').textContent = value.expired ? '생각할 시간 끝' : value.running ? '생각할 시간' : '일시정지';
      const toggle = node.querySelector('[data-action="timer-toggle"]');
      toggle.textContent = value.running ? '일시정지' : '시작';
      const locked = state.mode === 'personal' && (answer().correct || answer().revealed);
      toggle.disabled = value.expired || locked;
      node.querySelector('[data-action="timer-reset"]').disabled = locked;
    }
    function sync() {
      const s = active();
      if (!s || !s.settings.timerSeconds) return;
      s.timers ||= [];
      const index = s.index;
      if (!s.timers[index]) {
        s.timers[index] = root.StudyTimer.create({
          seconds: s.settings.timerSeconds,
          onTick(value) { if (active() === s && s.index === index) updateClock(value); },
          onExpire() {
            const a = s.responses[index];
            if (a.correct || a.revealed) return;
            a.timedOut = true; s.combo = 0;
            if (active() !== s || s.index !== index) return;
            if (s.mode === 'classroom' && s.settings.autoReveal && !s.reveals[index].answerShown) {
              s.reveals[index].panel = 'answer'; s.reveals[index].answerShown = true;
            }
            notify(s.mode === 'classroom' ? '생각할 시간이 끝났어요.' : '시간이 끝나도 계속 풀 수 있어요. 천천히 생각해 보세요.');
            render();
          }
        });
        if (!(s.mode === 'personal' && (answer().correct || answer().revealed))) s.timers[index].start();
      }
      updateClock(s.timers[index].snapshot());
    }
    function clockHtml() {
      if (!state.session.settings.timerSeconds) return '';
      return `<div class="study-timer" data-timer><span><small data-timer-state>생각할 시간</small><strong data-timer-value role="timer" aria-label="남은 시간">0:00</strong></span>${button('timer-toggle','일시정지','btn-small')}${button('timer-reset','초기화','btn-small')}</div>`;
    }
    function setupHtml() {
      const s = state.settings, personal = state.mode === 'personal', own = Ranking.getSelection();
      const presets = [0, 10, 20, 30, 60];
      return `<div class="form-section extension-settings"><h2 class="form-title"><span>04</span>학습 도구 (선택)</h2><label class="field-label" for="timer-select">문제마다 생각할 시간</label><select id="timer-select" data-setting="timerSeconds">${presets.map(n => `<option value="${n}" ${s.timerSeconds === n ? 'selected' : ''}>${n ? `${n}초` : '사용 안 함'}</option>`).join('')}<option value="custom" ${!presets.includes(s.timerSeconds) ? 'selected' : ''}>직접 설정</option></select><label class="timer-custom" for="timer-custom">직접 설정 (0: 사용 안 함, 최대 3600초)<input id="timer-custom" type="number" min="0" max="3600" step="1" value="${s.timerSeconds}" data-setting="timerSeconds"></label><p class="form-note">시간이 끝나도 다음 문제로 자동 이동하지 않아요.</p>${personal ? `<label class="checkbox-label"><input type="checkbox" data-setting="gamificationEnabled" ${s.gamificationEnabled ? 'checked' : ''}>점수·경험치·배지 사용</label><label class="checkbox-label"><input type="checkbox" data-setting="rankingEnabled" ${s.rankingEnabled ? 'checked' : ''}>완료한 학습을 우리 반 성장 점수에 반영</label>${s.rankingEnabled ? `<p>${own ? E(own.id) : '먼저 학급 랭킹에서 우리 반을 선택해 주세요.'}</p>${button('ranking','학급 선택하기','btn-quiet')}<label class="field-label" for="ranking-mode-select">반영할 랭킹</label><select id="ranking-mode-select" data-setting="rankingMode"><option value="online" ${s.rankingMode === 'online' ? 'selected' : ''}>온라인 전국 학급</option><option value="demo" ${s.rankingMode === 'demo' ? 'selected' : ''}>이 기기에서 데모 체험</option></select><p class="form-note">온라인은 학교·학년·반과 학습 점수·문제 수·정답 수를 전송해요. 5문제 이상을 끝까지 학습하면 한 번 반영해요.</p>` : ''}` : `<label class="checkbox-label"><input type="checkbox" data-setting="autoReveal" ${s.autoReveal ? 'checked' : ''}>시간이 끝나면 정답 공개</label>`}</div>`;
    }
    function prepare(s) {
      s.combo = 0; s.comboMax = 0; s.score = 0; s.timers = [];
      s.classroom = Ranking.getSelection();
      s.settings.rankingEnabled = s.mode === 'personal' && !s.isReview && s.settings.rankingEnabled === true && !!s.classroom;
      s.questionStartedAt = performance.now();
    }
    function moved() { state.session.questionStartedAt = performance.now(); }
    function submitted(a, result) {
      if (result.valid === false || result.code === 'invalid-input') return;
      const s = state.session, time = timer()?.snapshot();
      if (time?.expired) a.timedOut = true;
      if (result.correct) {
        a.solveSeconds = Math.max(0, (performance.now() - s.questionStartedAt) / 1000);
        const reward = Game.scoreAnswer({ correct: true, firstAttempt: a.firstCorrect,
          hintUsed: a.hintUsed, revealed: a.revealed, timedOut: a.timedOut,
          difficulty: s.settings.difficulty, combo: s.combo,
          timerEnabled: !!time?.enabled && !a.timerReset, remainingRatio: time ? 1 - time.elapsedSeconds / time.seconds : 0 });
        if (s.settings.gamificationEnabled) {
          a.score = reward.score; s.score += reward.score; s.combo = reward.combo;
          s.comboMax = Math.max(s.comboMax, s.combo);
        }
        pause();
      } else { s.combo = 0; a.hintUsed = true; }
    }
    function panel(name) {
      if (state.mode !== 'personal') return;
      const a = answer();
      if (!a.correct) {
        a.hintUsed = true; state.session.combo = 0;
        if (name === 'answer' || name === 'solution') pause();
      }
    }
    function gameHtml() {
      const s = state.session;
      if (!s.settings.gamificationEnabled) return '';
      return `<div class="session-growth" role="status"><strong>성장 점수 ${s.score}점</strong><span>연속 정답 ${s.combo}개</span>${answer().score ? `<span>이번 문제 +${answer().score}점</span>` : ''}</div>`;
    }
    function complete(record, atEnd) {
      const s = state.session;
      record.completed = atEnd && s.responses.every(a => a.attempts.length > 0 || a.revealed);
      Object.assign(record, { gameVersion: 1, gamificationEnabled: !!s.settings.gamificationEnabled,
        score: s.score, comboMax: s.comboMax, timerEnabled: !!s.settings.timerSeconds,
        timerSeconds: s.settings.timerSeconds, timeoutCount: s.responses.filter(a => a.timedOut).length,
        averageSolveSeconds: s.responses.filter(a => a.correct).reduce((sum, a) => sum + (a.solveSeconds || 0), 0) / Math.max(1, record.correct),
        rankingEnabled: s.settings.rankingEnabled, rankingMode: s.settings.rankingMode, classroom: s.classroom });
      record.classScoreContribution = Game.classContribution(record);
      record.classContributionStatus = record.rankingEnabled && record.completed ? 'pending' : 'not-joined';
      const reward = Game.applySession(record);
      record.expEarned = reward.expEarned; record.badgesEarned = reward.newBadges.map(b => b.id);
      if (!reward.ok) notify(reward.message);
    }
    async function contribute(record) {
      if (!record || busy.has(record.id) || !['pending', 'failed'].includes(record.classContributionStatus)) return;
      busy.add(record.id);
      try {
        const result = await Ranking.updateClassScore(record, { mode: record.rankingMode });
        record.classContributionStatus = result.ok ? record.rankingMode === 'demo' ? 'demo' : 'synced' : 'failed';
        const saved = root.LearningStorage.list().some(r => r.id === record.id) ? root.LearningStorage.save(record) : { ok: true };
        notify(result.message + (saved.ok ? '' : ` ${saved.message}`));
      } catch (_) {
        record.classContributionStatus = 'failed';
        if (root.LearningStorage.list().some(r => r.id === record.id)) root.LearningStorage.save(record);
        notify('학급 반영을 마치지 못했어요. 학습 기록에서 다시 시도해 주세요.');
      }
      finally { busy.delete(record.id); if (state.view === 'results' || state.view === 'history') render(); }
    }
    function recordHtml(r) {
      const status = { pending: '우리 반에 반영 중', synced: '우리 반 반영 완료', failed: '우리 반 반영 재시도 필요', demo: '데모 반영 완료', 'not-joined': '학급 반영 안 함' };
      if (r.gameVersion !== 1) return '';
      return `<div class="record-growth">${r.gamificationEnabled ? `<span>성장 ${r.score}점 · 경험치 +${r.expEarned} · 최대 연속 ${r.comboMax}개</span>` : ''}<span>${r.timerEnabled ? `문제당 ${r.timerSeconds}초 · 시간 종료 ${r.timeoutCount}회` : '타이머 사용 안 함'}</span>${r.rankingEnabled ? `<span>${E(status[r.classContributionStatus] || '')} (${r.classScoreContribution}점)</span>${['failed','pending'].includes(r.classContributionStatus) ? button('contribute','반영 다시 시도','btn-small','',`data-value="${E(r.id)}" ${busy.has(r.id) ? 'disabled' : ''}`) : ''}` : ''}</div>`;
    }
    function growthHtml() {
      const p = Game.profile();
      return `<section class="growth-profile"><span class="eyebrow">이 기기에 쌓인 나의 배움</span><h1>나의 성장</h1><div class="stats-grid"><div class="stat-card"><span>레벨</span><strong>${p.level}</strong><span>경험치 ${p.xp} · 다음 레벨까지 ${p.nextLevelXp - p.levelXp}</span></div><div class="stat-card"><span>해결한 문제</span><strong>${p.totalSolved}</strong><span>완료한 학습 ${p.completedSessions}회</span></div><div class="stat-card"><span>연속 학습</span><strong>${p.streak}일</strong><span>최대 연속 정답 ${p.maxCombo}개</span></div></div><h2>배움의 배지</h2><div class="badge-list">${p.badges.length ? p.badges.map(b => `<article><h3>${E(b.title)}</h3><p>${E(b.description)}</p></article>`).join('') : '<p>학습을 끝까지 마치면 첫 배지를 만날 수 있어요.</p>'}</div><p>점수는 정답 10점에 난이도·첫 시도·연속 정답·남은 시간 보너스를 더해요. 힌트와 시간 종료에는 벌점이 없어요.</p><p>경험치는 정답당 5, 완료 20, 도전 정답당 2, 하루 첫 완료 5를 더해요. 100마다 레벨이 올라요. 학급 점수는 5문제 이상 완료 시 10 + 첫 정답 수 × 5 + 정답률 × 20(반올림)이에요.</p><p>성장 기록은 학습 기록과 별도로 저장해요. 예전 기록을 열어도 보상을 새로 지급하지 않아요.</p></section>`;
    }
    function action(name, value) {
      if (name === 'contribute') { contribute(state.record?.id === value ? state.record : root.LearningStorage.list().find(r => r.id === value)); return true; }
      if (name !== 'timer-toggle' && name !== 'timer-reset') return false;
      if (!active() || !timer()) return true;
      if (state.mode === 'personal' && (answer().correct || answer().revealed)) return true;
      if (name === 'timer-reset') { answer().timerReset = true; timer().reset(); }
      else if (timer().snapshot().running) pause(); else timer().start();
      return true;
    }
    return { pause, destroy, sync, clockHtml, setupHtml, prepare, moved, submitted, panel, gameHtml, complete, contribute, recordHtml, growthHtml, action };
  }
  root.SessionExtras = Object.freeze({ create });
})(globalThis);
