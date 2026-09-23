(function () {
  'use strict';
  const U = FractionUI, M = FractionMath, B = ProblemBank, Store = LearningStorage;
  const app = document.getElementById('app');
  const dialog = document.getElementById('help-dialog');
  const E = U.esc;
  const state = {
    view: 'home', mode: 'personal',
    settings: {grade:4,unit:'g4-addsub',type:'all',difficulty:'normal',count:10,includeMixed:true,requireReduction:false,includeBorrow:true,timerSeconds:0,autoReveal:false,gamificationEnabled:true,rankingEnabled:false,rankingMode:'online'},
    session: null, record: null, storageMessage: '',
  };
  const levels = [{id:'easy',label:'기초',description:'작은 수로 원리부터'},{id:'normal',label:'기본',description:'교과서처럼 차근차근'},{id:'challenge',label:'도전',description:'여러 단계를 연결해요'}];
  const typeGroups = [{id:'addition',label:'덧셈 유형 골고루 섞기'},{id:'subtraction',label:'뺄셈 유형 골고루 섞기'}];
  let toastTimer;
  const button = (action,label,style='',icon='',extra='') => `<button type="button" class="btn ${style}" data-action="${action}" ${extra}>${icon?U.icon(icon):''}${label}</button>`;
  const extras = SessionExtras.create({state,button,esc:E,render,notify});
  const rankingUI = RankingUI.create({esc:E,button,notify,onChange:()=>{if(state.view==='legacy-ranking')render();}});
  const competitionUI = CompetitionUI.create({esc:E,button,notify,
    onChange:()=>{if(['competition-entry','competition-ranking'].includes(state.view))render();},
    onEnter:identity=>{
      state.mode='personal';state.view='setup';state.session=null;
      const grade=identity.classroom.grade;
      state.settings={...state.settings,grade,unit:B.curriculum.find(g=>g.grade===grade).units[0].id,type:'all',
        timerSeconds:0,autoReveal:false,rankingEnabled:true,rankingMode:'online',gamificationEnabled:true,
        includeMixed:true,includeBorrow:true,requireReduction:false};
      render();window.scrollTo(0,0);
    }});
  let rankingReturn = 'home';
  const current = () => state.session.problems[state.session.index];
  const response = () => state.session.responses[state.session.index];
  const reveal = () => state.session.reveals[state.session.index];
  const unit = () => B.getUnit(state.settings.grade,state.settings.unit);
  const selected = (a,b) => a===b?' selected':'';
  const freshResponse = () => ({attempts:[],correct:false,firstCorrect:false,revealed:false,draft:{},feedback:null});
  const freshReveal = () => ({panel:'',answerShown:false,step:0,model:'bars'});
  function notify(message) {
    const node=document.getElementById('notification');node.textContent=message;node.classList.add('visible');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('visible'),4500);
  }
  function header() {
    return `<header class="site-header"><button class="brand" data-action="home" aria-label="분수트레이너 처음으로"><span class="brand-mark" aria-hidden="true">¼</span><span>분수트레이너<small>FRACTION TRAINER</small></span></button><nav class="header-links" aria-label="주요 메뉴">${button('ranking','학급 랭킹','btn-quiet','chart')}${button('history','학습 기록','btn-quiet','history')}${button('help','단축키 안내','btn-quiet','help')}</nav></header>`;
  }
  function home() {
    const records=Store.list(),last=records[0];
    return `${header()}<main class="page-wrap"><section class="home-intro"><div><span class="eyebrow">분수 학습은 분수트레이너!</span><h1>분수, 차근차근.<br><span>혼자서도, 함께라면 더.</span></h1><p>눈으로 이해하고, 직접 풀어보며.<br>오늘의 분수 공부를 시작해 볼까요?</p></div></section><section class="mode-grid" aria-label="학습 방식 선택"><button class="mode-card classroom-card" data-action="mode" data-value="classroom"><span class="mode-top">${U.icon('board')} 전자칠판으로 함께 배우기</span><h2>선생님과 함께 수업</h2><p>한 문제에 집중하고, 생각을 나눠요.<br>힌트부터 풀이까지 선생님과 함께.</p><div class="mode-art board-art" aria-hidden="true"><div class="math-line">${U.tokens([{n:1,d:3},'+',{n:1,d:6}])}</div></div><span class="card-cta">입장하기 <span class="arrow-circle">${U.icon('arrow')}</span></span></button><button class="mode-card" data-action="mode" data-value="personal"><span class="mode-top">${U.icon('book')} 나의 랭킹은 어디?</span><h2>전국학급랭킹전</h2><p>내 점수와 우리 반 점수가 함께 쌓여요.</p><div class="mode-art paper-art" aria-hidden="true"><i class="art-line"></i><div class="math-line">${U.tokens([{n:3,d:4}])}</div><div class="art-bar"><i></i><i></i><i></i><i></i></div></div><span class="card-cta">입장하기 <span class="arrow-circle">${U.icon('arrow')}</span></span></button></section><footer class="home-footer"><span class="footer-brand">${U.icon('bulb')}빠르게 푸는 것보다, 이해하며 푸는 것이 중요해요.</span><span>${last?`최근 학습 ${formatDate(last.date)} · ${last.total}문제`:'학습 기록은 지금 사용하는 기기에 저장돼요.'}</span></footer></main>`;
  }
  function competitionSetup() {
    const s=state.settings,u=unit(),grade=B.curriculum.find(g=>g.grade===s.grade),identity=WeeklyCompetition.getIdentity();
    const types=[{id:'all',label:'골고루 연습하기'},...(u.id.endsWith('addsub')?typeGroups:[]),...u.types];
    const rules=LearningGame.RULES;
    return `${header()}<main class="page-wrap competition-setup"><section class="setup-heading"><span class="pill">${U.icon('book')}전국학급랭킹전</span><h1>오늘, 무엇에 도전해 볼까요?</h1><p>유형을 고르고, 나에게 맞는 난이도로 연습해요.</p></section><div class="competition-context"><div><strong>${E(identity?.nickname||'이번 주 닉네임으로 입장해 주세요')}</strong>${identity?`<p>${E(identity.classroom.id)}</p>`:''}</div>${button('competition-change','학교·닉네임 변경','btn-quiet')}</div><section class="setup-form" aria-label="랭킹전 문제 설정"><div class="form-section"><h2 class="form-title"><span>01</span>연습할 학년과 단원</h2><div class="choice-row">${B.curriculum.filter(g=>g.grade===identity?.classroom.grade).map(g=>`<button class="choice active" disabled><b>${g.grade}학년 · 우리 반</b></button>`).join('')}</div><div class="unit-choices">${grade.units.map(item=>`<button class="choice ${s.unit===item.id?'active':''}" data-action="unit" data-value="${item.id}" aria-pressed="${s.unit===item.id}"><b>${E(item.title)}</b><small>${E(item.description)}</small></button>`).join('')}</div></div><div class="form-section"><h2 class="form-title"><span>02</span>문제 유형을 골라요</h2><div class="competition-type-grid" role="group" aria-label="문제 유형">${types.map(t=>`<button class="choice ${s.type===t.id?'active':''}" data-action="problem-type" data-value="${t.id}" aria-pressed="${s.type===t.id}"><b>${E(t.label)}</b><small>정답 ${LearningGame.baseScore({...s,type:t.id})}점 + 보너스</small>${t.description?`<small>${E(t.description)}</small>`:''}</button>`).join('')}</div><p class="form-note">${s.grade===4?'값이 같은 분수도 정답이에요.':'문제에 적힌 약분·통분 조건을 확인해요.'}</p></div><div class="form-section"><h2 class="form-title"><span>03</span>나에게 맞는 난이도</h2><div class="choice-row">${levels.map(l=>`<button class="choice ${s.difficulty===l.id?'active':''}" data-action="difficulty" data-value="${l.id}" aria-pressed="${s.difficulty===l.id}"><b>${l.label}</b><small>${l.description}</small><small>정답 ${LearningGame.baseScore({...s,difficulty:l.id})}점 + 보너스</small></button>`).join('')}</div><p class="form-note">도움 없이 첫 시도에 맞히면 +${rules.firstAttempt}점, ${rules.comboThreshold}문제부터 연속 정답 보너스 +${rules.comboStep}~${rules.comboBonusMax}점이에요. 첫 시도에 도움 없이 맞히면 60초까지 빠를수록 기본 점수의 최대 50%를 추가로 받아요. 시간 제한은 없어요.</p></div><div class="setup-start"><div><span class="field-label">몇 문제에 도전할까요?</span><div class="choice-row" role="group" aria-label="문제 수">${[5,10,20].map(n=>`<button class="choice ${s.count===n?'active':''}" data-action="count" data-value="${n}" aria-pressed="${s.count===n}">${n}문제</button>`).join('')}</div></div>${button('start','도전 시작하기','btn-primary','arrow')}</div><p class="form-note">5문제 이상 끝까지 학습한 새 세트의 점수를 나와 우리 반에 함께 반영해요. 건너뛰거나 다시 푸는 오답 세트는 랭킹에 반영하지 않아요.</p></section></main>`;
  }
  function setup() {
    if(state.mode==='personal')return competitionSetup();
    const s=state.settings,u=unit(),classroom=state.mode==='classroom',grade=B.curriculum.find(g=>g.grade===s.grade);
    const mixedAvailable=u.types.some(t=>t.mixed),borrowAvailable=u.id==='g4-addsub'||u.id==='g5-addsub';
    const borrowRequired=u.types.some(t=>t.id===s.type&&t.borrow);
    const mixedSelection=['all',...typeGroups.map(t=>t.id)].includes(s.type);
    const groupOptions=borrowAvailable?typeGroups.map(t=>`<option value="${t.id}"${selected(s.type,t.id)}>${t.label}</option>`).join(''):'';
    return `${header()}<main class="page-wrap"><section class="setup-heading"><span class="pill">${U.icon(classroom?'board':'book')}${classroom?'전자칠판 수업':'개인 학습'}</span><h1>${classroom?'오늘은 어떤 분수를 함께 배울까요?':'오늘, 무엇을 연습해 볼까요?'}</h1><p>학년과 단원을 고르고, 나에게 맞는 문제로 시작해요.</p></section><div class="setup-layout"><aside class="setup-aside"><span class="eyebrow">${classroom?'함께 생각하는 시간':'한 걸음씩, 나의 속도로'}</span><h2>${classroom?'한 화면, 한 문제.':'이해가 쌓이는 연습.'}</h2><p>${classroom?'학생들은 공책에 풀고, 선생님은 필요한 순간에 힌트와 풀이를 열어 주세요.':'답을 직접 입력하면 바로 확인해요. 어려운 문제는 힌트를 보고 다시 도전해요.'}</p><ol class="learning-steps"><li><b>1</b>학년과 단원 고르기</li><li><b>2</b>유형과 난이도 정하기</li><li><b>3</b>${classroom?'크게 보고 함께 풀기':'직접 풀고 확인하기'}</li><li><b>4</b>${classroom?'생각과 풀이 나누기':'틀린 문제 다시 만나기'}</li></ol><div class="aside-bottom">${classroom?'전체화면과 키보드로 편하게 조작할 수 있어요. 수업 중에는 설정을 접어 문제에 집중해요.':'기본은 시간 제한이 없어요. 필요한 학습 도구를 선택해 내 속도로 풀어 보세요.'}</div></aside><section class="setup-form" aria-label="문제 세트 설정"><div class="form-section"><h2 class="form-title"><span>01</span>학년을 골라요</h2><div class="choice-row">${B.curriculum.map(g=>`<button class="choice ${s.grade===g.grade?'active':''}" data-action="grade" data-value="${g.grade}" aria-pressed="${s.grade===g.grade}"><b>${g.grade}학년</b><small>${g.grade===4?'분수 계산의 시작':g.grade===5?'약분부터 곱셈까지':'나눗셈의 원리'}</small></button>`).join('')}</div></div><div class="form-section"><h2 class="form-title"><span>02</span>단원과 문제 유형</h2><div class="unit-choices">${grade.units.map(item=>`<button class="choice ${s.unit===item.id?'active':''}" data-action="unit" data-value="${item.id}" aria-pressed="${s.unit===item.id}"><b>${E(item.title)}</b><small>${E(item.description)}</small></button>`).join('')}</div><label class="field-label" for="type-select">문제 유형</label><select id="type-select" data-setting="type"><option value="all"${selected(s.type,'all')}>여러 유형 골고루 섞기</option>${groupOptions}${u.types.map(t=>`<option value="${E(t.id)}"${selected(s.type,t.id)}>${E(t.label)}</option>`).join('')}</select><div class="options-grid">${mixedAvailable&&mixedSelection?`<label class="checkbox-label"><input type="checkbox" data-setting="includeMixed" ${s.includeMixed?'checked':''}>대분수 유형 포함</label>`:''}${borrowAvailable?`<label class="checkbox-label"><input type="checkbox" data-setting="includeBorrow" ${s.includeBorrow?'checked':''} ${borrowRequired?'disabled':''}>받아내림 포함</label>`:''}${u.id!=='g5-equivalence'&&s.grade>4?`<label class="checkbox-label"><input type="checkbox" data-setting="requireReduction" ${s.requireReduction?'checked':''}>약분할 수 있는 계산 결과</label>`:''}</div><p class="form-note">${mixedSelection?'선택한 조건에 맞는 유형을 골고루 출제해요.':'선택한 한 가지 유형을 집중 연습해요.'}${s.grade===4?' 4학년 계산은 약분하지 않아도 값이 같으면 정답이에요.':u.id==='g5-equivalence'?' 문제마다 빈칸·통분·기약분수 조건을 확인해요.':' 답은 자연수, 기약분수 또는 약분한 대분수로 나타내요.'}</p></div><div class="form-section"><h2 class="form-title"><span>03</span>어느 정도로 연습할까요?</h2><div class="choice-row">${levels.map(l=>`<button class="choice ${s.difficulty===l.id?'active':''}" data-action="difficulty" data-value="${l.id}" aria-pressed="${s.difficulty===l.id}"><b>${l.label}</b><small>${l.description}</small></button>`).join('')}</div></div>${extras.setupHtml()}<div class="setup-start"><label class="count-field" for="count-select">문제 수<select id="count-select" data-setting="count">${[5,10,20].map(n=>`<option value="${n}"${selected(s.count,n)}>${n}문제</option>`).join('')}</select></label>${button('start',classroom?'수업 시작하기':'학습 시작하기','btn-primary','arrow')}</div>${state.session&&state.session.mode===state.mode?`<div class="actions" style="margin-top:18px">${button('resume','진행 중인 문제로 돌아가기','btn-quiet','back')}</div>`:''}</section></div></main>`;
  }
  function start(problems=null, settings=null) {
    try {
      if(settings)state.settings={...state.settings,...settings};
      if(state.mode==='personal'&&!problems&&!WeeklyCompetition.getIdentity()){
        notify('이번 주 닉네임으로 입장한 뒤 학습을 시작해 주세요.');
        state.view='competition-entry';competitionUI.openEntry();return;
      }
      if(state.mode==='personal')Object.assign(state.settings,{timerSeconds:0,autoReveal:false,rankingEnabled:!problems,rankingMode:'online',gamificationEnabled:!problems,includeMixed:true,includeBorrow:true,requireReduction:false});
      if(state.mode==='personal'&&!problems){const grade=WeeklyCompetition.getIdentity().classroom.grade;if(state.settings.grade!==grade){state.settings.grade=grade;state.settings.unit=B.curriculum.find(g=>g.grade===grade).units[0].id;state.settings.type='all';}}
      const previous=state.session?.problems || [];
      const set=problems || B.generateSet(state.settings,previous);
      extras.destroy();
      state.session={id:`session-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,mode:state.mode,settings:{...state.settings},problems:set,index:0,responses:set.map(freshResponse),reveals:set.map(freshReveal),startedAt:Date.now(),isReview:!!problems};
      extras.prepare(state.session);
      state.view='session';state.record=null;render();focusAnswer();
    } catch(error) {notify(`문제를 만들지 못했어요. ${error.message}`);}
  }
  function revealPanel(p,r,classroom) {
    if(!r.panel)return '';
    const prefix=classroom?'reveal-panel':'study-reveal';
    if(r.panel==='hint')return `<section class="${prefix} hint-panel" aria-live="polite"><span class="reveal-label">생각을 여는 힌트</span><p class="step-text">${E(p.hint)}</p>${!classroom&&response().attempts.length>1?`<p class="step-text">${E(p.steps[0]?.text||'')}</p>`:''}</section>`;
    if(r.panel==='answer')return `<section class="${prefix} answer-panel" aria-live="polite"><span class="reveal-label">정답</span><div class="math-line answer-equation">${U.answer(p)}</div></section>`;
    if(r.panel==='solution'){
      const step=p.steps[r.step];
      return `<section class="${prefix} solution-panel" aria-live="polite"><div class="step-heading"><h2><span class="reveal-label">${r.step+1} / ${p.steps.length}</span> ${E(step.title)}</h2><div class="step-nav">${button('step-prev','이전 단계','btn-small','',r.step===0?'disabled':'')}${button('step-next','다음 단계','btn-small','',r.step===p.steps.length-1?'disabled':'')}</div></div><p class="step-text">${E(step.text)}</p>${step.tokens?.length?`<div class="math-line step-equation">${U.tokens(step.tokens)}</div>`:''}</section>`;
    }
    const options=U.visualOptions(p);
    return `<section class="${prefix} visual-panel"><div class="visual-tabs">${options.map(o=>button('visual-model',o.label,`btn-small ${r.model===o.id?'btn-primary':''}`,'',`data-value="${o.id}" aria-pressed="${r.model===o.id}"`)).join('')}</div><div class="visual-content">${U.visual(p,r.model)}</div></section>`;
  }
  function classroom() {
    const s=state.session,p=current(),r=reveal(),u=B.getUnit(s.settings.grade,s.settings.unit);
    return `<main class="classroom-shell"><header class="classroom-header">${button('settings','유형 변경','btn-quiet classroom-settings','back')}<div class="classroom-context"><span class="eyebrow">${s.settings.grade}학년</span><strong>${E(u.title)}</strong></div>${extras.clockHtml()}<span class="classroom-counter">문제 ${s.index+1} <span class="muted">/ ${s.problems.length}</span></span></header><section class="classroom-stage ${r.panel?'has-reveal':''}" aria-label="현재 문제"><h1 class="problem-prompt">${E(p.prompt)}</h1><div class="math-line problem-equation">${U.equation(p)}</div>${revealPanel(p,r,true)}</section><footer class="teacher-controls">${button('hint','힌트',r.panel==='hint'?'btn-gold':'','bulb')}${button('answer',r.answerShown?'정답 다시 보기':'정답 보기','btn-primary','check')}${button('solution','풀이 보기',r.panel==='solution'?'btn-gold':'','steps',r.answerShown?'':'disabled')}${button('previous','이전 문제','','back',s.index===0?'disabled':'')}${button('next',s.index===s.problems.length-1?'수업 마무리':'다음 문제','btn-dark','arrow')}</footer><nav class="classroom-toolbar" aria-label="수업 도구">${button('new-problem','새 문제','btn-quiet','refresh')}${button('visual','그림으로 보기','btn-quiet','chart')}${button('fullscreen',document.fullscreenElement?'전체화면 종료':'전체화면','btn-quiet','full')}${button('help','단축키 안내','btn-quiet','help')}${button('finish','수업 마치기','btn-quiet')}</nav></main>`;
  }
  function fractionInputs(prefix='',withWhole=true,draft={}) {
    const input=(name,label)=>`<label for="${prefix}${name}">${label}<input id="${prefix}${name}" name="${prefix}${name}" inputmode="numeric" type="text" autocomplete="off" maxlength="5" pattern="[0-9]*" value="${E(draft[prefix+name]||'')}" aria-label="${prefix?prefix==='a-'?'첫 번째 분수 ':'두 번째 분수 ':''}${label}"></label>`;
    return `<div class="fraction-input-row">${withWhole?`<label class="whole-entry" for="whole">자연수 (선택)<input id="whole" name="whole" inputmode="numeric" type="text" autocomplete="off" maxlength="5" pattern="[0-9]*" value="${E(draft.whole||'')}" aria-label="자연수"></label>`:''}<div class="fraction-entry">${input('num','분자')}<div aria-hidden="true"></div>${input('den','분모')}</div></div>`;
  }
  function answerForm(p,a) {
    if(a.correct||a.revealed)return `<div class="answer-form"><div class="feedback ${a.revealed&&!a.correct?'retry':''}" role="status">${a.correct?'정답이에요! 한 문제를 해결했어요.':'정답 또는 풀이를 확인한 문제예요. 이해했다면 다음 문제로 가요.'}</div></div>`;
    let fields='';
    if(p.kind==='compare')fields=`<div class="compare-inputs" role="group" aria-label="비교 기호">${['<','=','>'].map(v=>`<button type="button" class="btn ${a.draft.symbol===v?'selected':''}" data-action="symbol" data-value="${E(v)}" aria-pressed="${a.draft.symbol===v}" aria-label="${v==='<'?'왼쪽이 더 작다':v==='>'?'왼쪽이 더 크다':'크기가 같다'}">${E(v)}</button>`).join('')}</div>`;
    else if(p.kind==='equivalent'||p.kind==='common-denominator')fields=`<label for="integer">${p.kind==='equivalent'?'빈칸에 들어갈 분자':'가장 작은 공통분모'}</label><input id="integer" class="integer-input" name="integer" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" autocomplete="off" value="${E(a.draft.integer||'')}">`;
    else if(p.kind==='common')fields=`<div class="common-inputs"><div class="common-entry"><span>첫 번째 분수</span>${fractionInputs('a-',false,a.draft)}</div><div class="common-entry"><span>두 번째 분수</span>${fractionInputs('b-',false,a.draft)}</div></div>`;
    else fields=fractionInputs('',true,a.draft);
    return `<form id="answer-form" class="answer-form" novalidate>${fields}<p class="answer-instructions">${p.kind==='calculation'||p.kind==='simplify'?'분수는 분자·분모만, 대분수는 자연수도 입력해요. 자연수 답은 자연수 칸만 입력해요.':'문제의 조건에 맞게 입력해요.'} Tab으로 이동 · Enter로 확인</p><button class="btn btn-primary" type="submit">정답 확인 ${U.icon('check')}</button>${a.feedback?`<div class="feedback retry" role="status">${E(a.feedback.message)}</div>`:''}</form>`;
  }
  function personal() {
    const s=state.session,p=current(),a=response(),r=reveal();
    return `${header()}<main class="study-wrap"><div class="study-top"><div class="context"><span class="pill">${s.isReview?'오답 다시 풀기':`${s.settings.grade}학년`}</span><strong>${E(B.getUnit(s.settings.grade,s.settings.unit).title)}</strong></div>${button('finish','여기까지 결과 보기','btn-quiet')}</div><div class="progress-track" role="progressbar" aria-label="학습 진행" aria-valuenow="${s.index+1}" aria-valuemin="0" aria-valuemax="${s.problems.length}"><i style="width:${(s.index+1)/s.problems.length*100}%"></i></div><section class="study-card">${extras.clockHtml()}<p class="problem-tag">문제 ${s.index+1} / ${s.problems.length} · ${E(p.typeLabel)}</p><h1 class="problem-prompt">${E(p.prompt)}</h1><div class="math-line problem-equation">${U.equation(p)}</div>${answerForm(p,a)}${extras.gameHtml()}<div class="study-support">${button('hint','힌트','btn-quiet','bulb')}${button('visual','그림으로 이해하기','btn-quiet','chart')}${button('solution','정답과 풀이','btn-quiet','steps')}</div>${revealPanel(p,r,false)}</section><div class="study-bottom"><p>천천히 생각해도 괜찮아요.<br>이해하는 만큼 실력이 자라요.</p>${button('next',s.index===s.problems.length-1?'학습 결과 보기':a.correct||a.revealed?'다음 문제':'건너뛰기',a.correct||a.revealed?'btn-primary':'','arrow')}</div></main>`;
  }
  function getInput(p) {
    const d=response().draft;
    if(p.kind==='compare')return {symbol:d.symbol||''};
    if(p.kind==='equivalent'||p.kind==='common-denominator')return {integer:d.integer||''};
    if(p.kind==='common')return [{num:d['a-num']||'',den:d['a-den']||''},{num:d['b-num']||'',den:d['b-den']||''}];
    return {whole:d.whole||'',num:d.num||'',den:d.den||''};
  }
  function submit() {
    if(state.view!=='session'||state.mode!=='personal')return;
    const p=current(),a=response();if(a.correct||a.revealed)return;
    const input=getInput(p),result=M.gradeAnswer(p,input);a.feedback=result;
    if(result.valid!==false&&result.code!=='invalid-input')a.attempts.push({input,code:result.code,correct:result.correct});
    if(result.correct){a.correct=true;a.firstCorrect=a.attempts.length===1;reveal().panel='';}
    else if(result.code!=='invalid-input')reveal().panel='hint';
    extras.submitted(a,result);
    render();if(result.correct)app.querySelector('[data-action="next"]')?.focus();else focusAnswer();
  }
  function showPanel(panel) {
    extras.panel(panel);
    const r=reveal(),a=response();
    if(panel==='solution'&&state.mode==='classroom'&&!r.answerShown){r.panel='answer';r.answerShown=true;}
    else {r.panel=panel;if(panel==='answer'||panel==='solution')r.answerShown=true;}
    if(state.mode==='personal'&&(panel==='solution'||panel==='answer')&&!a.correct)a.revealed=true;
    render();
  }
  function move(offset) {
    const s=state.session;extras.pause();if(!response().correct)s.combo=0;if(offset>0&&s.index===s.problems.length-1){finish(true);return;}
    s.index=Math.max(0,Math.min(s.problems.length-1,s.index+offset));extras.moved();render();focusAnswer();
  }
  function finish(atEnd=false) {
    if(!state.session)return;
    extras.pause();
    if(state.mode==='personal'&&state.record?.id===state.session.id){state.view='results';render();return;}
    if(state.mode==='classroom'){state.view='classroom-end';render();return;}
    const s=state.session;
    const record={id:s.id,date:new Date().toISOString(),settings:s.settings,total:s.problems.length,correct:s.responses.filter(a=>a.correct).length,firstCorrect:s.responses.filter(a=>a.firstCorrect).length,durationSeconds:Math.round((Date.now()-s.startedAt)/1000),wrongProblems:s.problems.filter((_,i)=>!s.responses[i].firstCorrect),attempts:s.responses.map((a,i)=>({problemId:s.problems[i].id,correct:a.correct,firstCorrect:a.firstCorrect,revealed:a.revealed,attempts:a.attempts}))};
    extras.complete(record,atEnd);
    state.record=record;const saved=Store.save(record);state.storageMessage=saved.ok?'':saved.message;state.view='results';render();
    if(record.classContributionStatus==='pending')extras.contribute(record);
  }
  const formatDate = date => new Date(date).toLocaleDateString('ko-KR',{month:'long',day:'numeric'});
  const duration = seconds => `${Math.floor(seconds/60)}분 ${seconds%60}초`;
  function safeProblems(items) {
    return (Array.isArray(items)?items:[]).filter(p=>p&&B.getUnit(p.grade,p.unit)?.types.some(t=>t.id===p.type)&&Array.isArray(p.operands)&&p.operands.length>0&&p.operands.every(f=>Number.isSafeInteger(f.n)&&Number.isSafeInteger(f.d)&&f.d>0&&f.n>=0&&f.n<=10000&&f.d<=1000)&&Array.isArray(p.steps)&&p.steps.length>0&&p.steps.every(s=>s&&typeof s.text==='string')).slice(0,20);
  }
  function results() {
    const r=state.record,s=state.session,wrong=safeProblems(r.wrongProblems),rate=r.total?Math.round(r.firstCorrect/r.total*100):0;
    return `${header()}<main class="report-wrap"><span class="eyebrow">오늘의 배움을 돌아봐요</span><h1>${r.firstCorrect===r.total?'차근차근, 모두 해결했어요!':'한 번의 연습이 실력이 되었어요.'}</h1><p>${r.settings.grade}학년 · ${E(B.getUnit(r.settings.grade,r.settings.unit).title)} · ${formatDate(r.date)}</p>${extras.celebrationHtml(r)}<div class="stats-grid"><div class="stat-card"><span>첫 풀이 정답</span><strong>${r.firstCorrect}<small> / ${r.total}</small></strong><span>처음 제출해서 맞힌 문제</span></div><div class="stat-card"><span>첫 풀이 정답률</span><strong>${rate}%</strong><span>다시 도전해 해결한 문제 ${r.correct-r.firstCorrect}개</span></div><div class="stat-card"><span>학습 시간</span><strong>${duration(r.durationSeconds)}</strong><span>${r.timerEnabled?`문제마다 ${r.timerSeconds}초를 설정했어요`:'시간 제한 없이 생각했어요'}</span></div></div>${extras.recordHtml(r)}${state.storageMessage?`<p class="storage-note">${E(state.storageMessage)}</p>`:'<p class="report-caption">학습 결과를 이 기기에 저장했어요. 정답을 확인하거나 건너뛴 문제는 다시 연습할 수 있어요.</p>'}<div class="actions">${button('review-current',`다시 연습하기 (${wrong.length}문제)`,'btn-primary','refresh',wrong.length?'':'disabled')}${button('start','새 문제로 연습하기','','arrow')}${button('home','처음으로','btn-quiet')}</div><section class="review-list" aria-label="문제별 결과">${s.problems.map((p,i)=>`<article class="review-row"><div><span class="result-icon">${i+1}. ${s.responses[i].firstCorrect?'첫 풀이 정답':s.responses[i].correct?'재도전 성공':s.responses[i].revealed?'풀이 확인':'다시 연습'}</span><p>${E(p.typeLabel)}</p></div><div class="math-line">${U.equation(p)}</div><div class="math-line"><span class="math-word">정답</span>${U.answer(p)}</div></article>`).join('')}</section></main>`;
  }
  function history() {
    const records=Store.list();
    return `${header()}<main class="report-wrap"><span class="eyebrow">차곡차곡 쌓인 학습 기록</span><div class="history-heading"><h1>학습 기록</h1>${button('clear-history','기록 지우기','btn-quiet','',''+(records.length?'':'disabled'))}</div><p>이 브라우저에 최근 ${Store.limit}회의 학습을 보관해요. 다른 기기와는 공유되지 않아요. 기록을 지워도 서버에 반영한 주간 랭킹 점수는 유지돼요.</p>${!Store.available()?'<p class="storage-note">기기 저장을 사용할 수 없어요. 현재 창에 있는 기록만 확인할 수 있어요.</p>':''}${records.length?records.map(r=>{const u=B.getUnit(r.settings.grade,r.settings.unit),wrong=safeProblems(r.wrongProblems);return `<article class="history-row"><div><span class="eyebrow">${formatDate(r.date)} · ${E(r.settings.grade)}학년</span><h3>${E(u?.title||'분수 학습')}</h3><p>${E(u?.types.find(t=>t.id===r.settings.type)?.label||typeGroups.find(t=>t.id===r.settings.type)?.label||'여러 유형')} · ${E(levels.find(l=>l.id===r.settings.difficulty)?.label||'기본')} · ${r.total}문제 · 첫 풀이 ${r.firstCorrect}개 정답 (${r.total?Math.round(r.firstCorrect/r.total*100):0}%) · ${duration(r.durationSeconds)}</p>${extras.recordHtml(r)}</div>${button('review-history',`다시 풀기 ${wrong.length}문제`,'','refresh',`data-value="${E(r.id)}" ${wrong.length?'':'disabled'}`)}</article>`;}).join(''):`<div class="empty-state"><h2>첫 번째 배움을 기다리고 있어요</h2><p>개인 학습을 마치면 정답률과 다시 풀 문제가 여기에 쌓여요.</p></div>`}<div class="actions" style="margin-top:25px">${button('mode','전국학급랭킹전 입장','btn-primary','book','data-value="personal"')}${button('home','처음으로','btn-quiet','back')}</div></main>`;
  }
  function classroomEnd() {
    const problems=state.session.problems;
    return `${header()}<main class="finish-class"><span class="pill">${U.icon('board')}함께한 분수 수업</span><h1>오늘의 생각을 나눠 볼까요?</h1><p>어떤 방법으로 풀었나요?<br>친구의 풀이와 내 풀이를 비교해 보세요.</p><div class="actions">${button('start','새 문제 세트','btn-primary','refresh')}${button('resume','문제로 돌아가기','','back')}${button('settings','단원·유형 변경','','book')}${button('home','처음으로','btn-quiet')}</div><details class="classroom-review"><summary>이번 회차 문제와 정답 보기 (${problems.length}문제)</summary><section class="review-list" aria-label="수업 문제와 정답">${problems.map((p,i)=>`<article class="review-row"><div><strong>${i+1}번</strong><p>${E(p.typeLabel)}</p></div><div class="math-line">${U.equation(p)}</div><div class="math-line"><span class="math-word">정답</span>${U.answer(p)}</div></article>`).join('')}</section></details></main>`;
  }
  function focusAnswer() {
    if(state.mode!=='personal'||state.view!=='session')return;
    const p=current(),a=response();if(a.correct||a.revealed)return;
    const field=app.querySelector(p.kind==='common'?'#a-num':p.kind==='equivalent'||p.kind==='common-denominator'?'#integer':'#num')||app.querySelector('.compare-inputs button');
    field?.focus({preventScroll:true});
  }
  function render() {
    // Replacing a view must not send keyboard users back to the start of the page.
    const focused=document.activeElement;
    const focusId=focused?.id;
    const focusAction=focused?.dataset?.action;
    const focusValue=focused?.dataset?.value;
    const board=state.view==='session'&&state.mode==='classroom';
    document.body.className=`${board?'classroom-mode':''}${document.fullscreenElement?' fullscreen':''}`;
    if(!['competition-entry','competition-ranking'].includes(state.view))competitionUI.leave();
    app.innerHTML=state.view==='home'?home():state.view==='setup'?setup():state.view==='session'?(board?classroom():personal()):state.view==='results'?results():state.view==='history'?history():state.view==='competition-entry'?`${header()}<main class="report-wrap">${button('home','처음으로','btn-quiet','back')}${competitionUI.entryHtml()}</main>`:state.view==='competition-ranking'?`${header()}<main class="report-wrap">${button('ranking-back','이전 화면으로','btn-quiet','back')}${competitionUI.boardHtml()}</main>`:state.view==='legacy-ranking'?`${header()}<main class="report-wrap">${button('ranking','주간 랭킹으로','btn-quiet','back')}${rankingUI.render()}</main>`:classroomEnd();
    Scratchpad.mount(state.view==='session' ? state.session : null);
    extras.sync();
    document.title=`${board?'수업 중 · ':''}분수트레이너`;
    const restore=focusId?document.getElementById(focusId):focusAction?[...app.querySelectorAll('[data-action]')].find(el=>el.dataset.action===focusAction&&el.dataset.value===focusValue&&!el.disabled):null;
    if(restore&&restore!==document.body)restore.focus({preventScroll:true});
  }
  function openHelp() {
    extras.pause();
    dialog.innerHTML=`<div class="dialog-header"><h2 id="dialog-title">${state.mode==='classroom'?'수업을 편하게, 키보드로':'분수트레이너 단축키 안내'}</h2>${button('close-dialog','닫기','btn-quiet','close')}</div><div class="help-list">${[['→','다음 문제'],['←','이전 문제'],['Space','정답 보기'],['H','힌트'],['S','풀이 보기'],['F','전체화면'],['T','타이머 시작 / 일시정지'],['R','타이머 초기화']].map(([key,label])=>`<div><kbd>${key}</kbd>${label}</div>`).join('')}</div><p>단축키는 전자칠판 수업 중에만 작동해요. 입력 칸이나 이 도움말이 열려 있을 때는 작동하지 않아요. 풀이 보기는 정답 공개 후 사용할 수 있어요.</p><p>전체화면은 F 또는 화면의 버튼으로 켜고 끌 수 있어요. Esc로도 나올 수 있어요. 그림을 열면 막대·원·수직선으로 분수의 양을 확인할 수 있어요.</p><p>개인 학습: Tab으로 자연수·분자·분모 칸을 이동하고 Enter로 제출해요. 틀린 문제와 풀이를 본 문제는 학습 결과에서 다시 풀 수 있어요.</p>`;
    dialog.showModal();
  }
  async function fullscreen() {
    try {if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else notify('이 브라우저에서는 전체화면 버튼을 지원하지 않아요. 브라우저의 전체화면 기능을 사용해 주세요.');}
    catch(_){notify('전체화면을 열 수 없어요. 브라우저의 전체화면 기능을 사용해 주세요.');}
  }
  function action(name,value) {
    if(extras.action(name,value))return;
    if(['competition-entry','competition-ranking'].includes(state.view)&&competitionUI.action(name,value))return;
    if(state.view==='legacy-ranking'&&rankingUI.action(name,value))return;
    if(name==='ranking-back'){state.view=rankingReturn;if(state.view==='competition-entry')competitionUI.openEntry();else render();return;}
    if(name==='ranking'){if(state.view==='session'&&state.mode==='personal')finish();extras.pause();if(!['competition-ranking','legacy-ranking'].includes(state.view))rankingReturn=state.view;state.view='competition-ranking';competitionUI.openBoard();window.scrollTo(0,0);return;}
    if(name==='legacy-ranking'){state.view='legacy-ranking';render();window.scrollTo(0,0);return;}
    if(name==='close-dialog'){dialog.close();return;}
    if(name==='help'){openHelp();return;}
    if(name==='fullscreen'){fullscreen();return;}
    if(name==='home'){if(state.view==='session'&&state.mode==='personal'){finish();return;}extras.destroy();state.view='home';state.session=null;render();window.scrollTo(0,0);return;}
    if(name==='history'){if(state.view==='session'&&state.mode==='personal')finish();state.view='history';render();window.scrollTo(0,0);return;}
    if(name==='mode'||name==='competition-change'){
      extras.destroy();state.mode=name==='competition-change'?'personal':value;state.session=null;
      if(state.mode==='personal'){state.view='competition-entry';competitionUI.openEntry();}
      else{state.view='setup';render();}
      window.scrollTo(0,0);return;
    }
    if(name==='grade'){if(state.mode==='personal'&&Number(value)!==WeeklyCompetition.getIdentity()?.classroom.grade)return;state.settings.grade=Number(value);state.settings.unit=B.curriculum.find(g=>g.grade===Number(value)).units[0].id;state.settings.type='all';state.settings.requireReduction=false;render();return;}
    if(name==='unit'){if(!B.curriculum.find(g=>g.grade===state.settings.grade)?.units.some(u=>u.id===value))return;state.settings.unit=value;state.settings.type='all';state.settings.requireReduction=false;render();return;}
    if(name==='difficulty'){state.settings.difficulty=value;render();return;}
    if(name==='problem-type'&&state.mode==='personal'){
      if(['all',...typeGroups.map(t=>t.id),...unit().types.map(t=>t.id)].includes(value)){state.settings.type=value;render();}return;
    }
    if(name==='count'&&[5,10,20].includes(Number(value))){state.settings.count=Number(value);render();return;}
    if(name==='start'){start();window.scrollTo(0,0);return;}
    if(name==='settings'){extras.pause();state.settings={...state.session.settings};state.view='setup';render();window.scrollTo(0,0);return;}
    if(name==='resume'){state.settings={...state.session.settings};state.mode=state.session.mode;state.view='session';render();return;}
    if(name==='finish'){finish();window.scrollTo(0,0);return;}
    if(name==='review-current'||name==='review-history'){
      const r=name==='review-current'?state.record:Store.list().find(r=>r.id===value);if(!r)return;
      const problems=safeProblems(r.wrongProblems);if(!problems.length){notify('다시 풀 문제가 없어요.');return;}
      state.mode='personal';start(problems,{...r.settings,rankingEnabled:false});window.scrollTo(0,0);return;
    }
    if(name==='clear-history'){dialog.innerHTML=`<div class="dialog-header"><h2 id="dialog-title">학습 기록을 지울까요?</h2></div><p>이 기기에 저장된 학습 기록이 모두 지워져요.</p><div class="actions" style="margin-top:24px">${button('close-dialog','기록 유지','btn-primary')}${button('confirm-clear','모두 지우기')}</div>`;dialog.showModal();return;}
    if(name==='confirm-clear'){const result=Store.clear();dialog.close();notify(result.message);render();return;}
    if(state.view!=='session')return;
    if(name==='next'){move(1);return;}if(name==='previous'){move(-1);return;}
    if(['hint','answer','solution','visual'].includes(name)){showPanel(name);return;}
    if(name==='step-next'||name==='step-prev'){reveal().step=Math.max(0,Math.min(current().steps.length-1,reveal().step+(name==='step-next'?1:-1)));render();return;}
    if(name==='visual-model'){reveal().model=value;render();return;}
    if(name==='symbol'){response().draft.symbol=value;render();app.querySelector('[type="submit"]')?.focus();return;}
    if(name==='new-problem'){
      try {const s=state.session,settings={...s.settings,type:current().type,count:5},p=B.generateSet(settings,s.problems)[0];s.timers[s.index]?.destroy();s.timers[s.index]=null;extras.moved();s.problems[s.index]=p;s.responses[s.index]=freshResponse();s.reveals[s.index]=freshReveal();render();}
      catch(error){notify(error.message);}return;
    }
  }
  document.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(target&&!target.disabled)action(target.dataset.action,target.dataset.value);});
  app.addEventListener('change',event=>{
    if(['competition-entry','competition-ranking'].includes(state.view)&&competitionUI.change(event))return;
    if(state.view==='legacy-ranking'&&rankingUI.change(event))return;
    const key=event.target.dataset.setting;if(!key)return;
    if(key==='timerSeconds'){
      if(event.target.value==='custom'){document.getElementById('timer-custom')?.focus();return;}
      const seconds=Number(event.target.value);
      if(event.target.value.trim()===''||!Number.isInteger(seconds)||seconds<0||seconds>3600){notify('시간은 0 또는 1~3600초의 정수로 입력해 주세요.');event.target.value=state.settings.timerSeconds;return;}
      state.settings.timerSeconds=seconds;render();document.getElementById(event.target.id)?.focus({preventScroll:true});return;
    }
    state.settings[key]=event.target.type==='checkbox'?event.target.checked:key==='count'?Number(event.target.value):event.target.value;
    if(key==='type'&&unit().types.some(t=>t.id===state.settings.type&&t.borrow))state.settings.includeBorrow=true;
    const id=event.target.id;render();if(id)document.getElementById(id)?.focus({preventScroll:true});
  });
  app.addEventListener('input',event=>{if(state.view==='competition-entry'&&competitionUI.input(event))return;if(state.view==='session'&&state.mode==='personal'&&event.target.name)response().draft[event.target.name]=event.target.value;});
  app.addEventListener('submit',event=>{if(event.target.id==='answer-form'){event.preventDefault();submit();}});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&document.fullscreenElement&&!dialog.open){document.exitFullscreen().catch(()=>{});return;}
    if(state.view==='session'&&state.mode==='personal'&&!dialog.open&&event.key==='Enter'&&!event.isComposing&&event.target.matches('#answer-form input')){event.preventDefault();submit();return;}
    if(state.view!=='session'||state.mode!=='classroom'||dialog.open||event.ctrlKey||event.altKey||event.metaKey||event.repeat)return;
    if(event.target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'))return;
    if(event.key===' '&&event.target.closest('.scratch-panel button'))return;
    const key=event.key.toLowerCase(),mapping={arrowright:'next',arrowleft:'previous',' ':'answer',h:'hint',s:'solution',f:'fullscreen',t:'timer-toggle',r:'timer-reset'};
    if(mapping[key]){event.preventDefault();action(mapping[key]);}
  });
  document.addEventListener('fullscreenchange',()=>{if(state.view==='session')render();});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){extras.pause();competitionUI.leave();}
    else if(state.view==='competition-ranking')competitionUI.openBoard();
    else if(state.view==='competition-entry')competitionUI.openEntry();
  });
  window.addEventListener('pagehide',()=>{extras.destroy();competitionUI.destroy();});
  render();
})();
