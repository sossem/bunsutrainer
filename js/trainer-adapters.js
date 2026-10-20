(function(root){
  'use strict';
  const E=root.FractionUI.esc,D=root.DecimalTrainer;
  function model(m){
    if(!m)return '';
    if(m.kind==='strip'||m.kind==='scale')return `<div class="decimal-model"><p>띠 하나 = ${E(m.base||'1')} · 한 칸은 전체의 1/10</p>${Array.from({length:m.whole+1},(_,r)=>`<div class="decimal-strip">${Array.from({length:10},(_,i)=>`<span class="${r<m.whole||i<m.k?'marked':''}">${r<m.whole||i<m.k?'●':''}</span>`).join('')}</div>`).join('')}</div>`;
    if(m.kind==='grid'||m.kind==='area')return `<div class="decimal-model"><p>전체 사각형 = 1 · 가로 10칸, 세로 10칸${m.kind==='area'?` · 가로 ${m.x}칸과 세로 ${m.y}칸의 겹친 부분`:''}</p><div class="decimal-grid">${Array.from({length:100},(_,i)=>{const x=i%10,y=Math.floor(i/10),filled=m.kind==='grid'?i<m.count:x<m.x&&y<m.y;return `<span class="${filled?'marked':m.kind==='area'&&(x<m.x||y<m.y)?'partial':''}">${filled?'●':''}</span>`;}).join('')}</div></div>`;
    if(m.kind==='line')return `<svg class="decimal-line" viewBox="0 0 600 90" role="img" aria-label="${m.start}부터 ${m.start+1}까지 10등분한 수직선"><line x1="30" y1="40" x2="570" y2="40" stroke="currentColor" stroke-width="3"/>${Array.from({length:11},(_,i)=>`<line x1="${30+54*i}" x2="${30+54*i}" y1="30" y2="50" stroke="currentColor"/><text x="${30+54*i}" y="78" font-size="18" text-anchor="middle">${m.marked==null?i:i===0?m.start:i===10?m.start+1:''}</text>${m.marked===i?`<circle cx="${30+54*i}" cy="40" r="8" fill="currentColor"/>`:''}`).join('')}</svg>`;
    if(m.kind==='place'){const[a,b='']=m.value.split('.');return `<div class="decimal-model">${m.zoom?'<p>1 → 10등분 → 0.1 → 10등분 → 0.01 → 10등분 → 0.001</p>':''}<table><thead><tr>${['일','0.1','0.01','0.001'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody><tr>${[a,...b.padEnd(3,'0')].map(x=>`<td>${E(x)}</td>`).join('')}</tr></tbody></table></div>`;}
    if(m.kind==='alignment'){const s=Math.max(...[m.a,m.b].map(x=>(x.split('.')[1]||'').length)),fmt=x=>{const[a,b='']=x.split('.');return a+'.'+b.padEnd(s,'0');};return `<div class="decimal-alignment"><div>${E(fmt(m.a))}</div><div>${m.operator} ${E(fmt(m.b))}</div><hr></div>`;}
    return '';
  }
  function answer(p){const a=p.answer;return `<span class="decimal-number">${E(p.answerKind==='fraction'?`${a.n}/${a.d}`:p.answerKind==='ratio'?`${a.n} : ${a.d}`:p.answerKind==='remainder'?`${a.quotient}개, ${a.remainder} m`:Array.isArray(a)?a.join(' < '):a)}</span>`;}
  const UI={...root.FractionUI,equation:p=>`<div class="decimal-expression">${p.expression?`<span class="decimal-number">${E(p.expression)}</span>`:''}${model(p.model)}</div>`,answer,visualOptions:()=>[{id:'decimal',label:'소수 모형'}],visual:p=>model(p.model)||'<p class="visual-caption">힌트와 단계별 풀이에서 자릿값과 계산 방법을 확인해 보세요.</p>'};
  function fields(p,a){const k=p.answerKind,d=a.draft;
    if(['choice','symbol','order'].includes(k))return `<div class="compare-inputs decimal-options">${p.choices.map((v,i)=>`<button type="button" class="btn ${d.value===v?'selected':''}" data-action="decimal-choice" data-value="${i}" ${k==='order'&&(d.order||[]).includes(v)?'disabled':''}>${E(v)}</button>`).join('')}</div>${k==='order'?`<p>선택 순서: ${E((d.order||[]).join(' → '))}</p><button type="button" class="btn btn-quiet" data-action="decimal-order-reset">순서 다시 고르기</button>`:''}`;
    const list=['fraction','ratio','remainder'].includes(k)?[['first',k==='fraction'?'분자':k==='ratio'?'앞 항':'완전한 조각 수'],['second',k==='fraction'?'분모':k==='ratio'?'뒤 항':'남는 길이 (m)']]:[['value','정답']];
    return `<div class="decimal-inputs">${list.map(([key,label])=>`<label for="decimal-${key}">${label}<input id="decimal-${key}" name="${key}" class="integer-input" inputmode="decimal" autocomplete="off" maxlength="32" value="${E(d[key]||'')}"></label>`).join('')}</div><div class="decimal-keypad" aria-label="숫자 키패드">${['1','2','3','4','5','6','7','8','9','.','0','⌫'].map(v=>`<button type="button" class="btn btn-small" data-action="decimal-key" data-value="${v}">${v}</button>`).join('')}</div>`;
  }
  const key='sosu.learning.v1';let records=null,compatible=true;
  function load(){if(records)return;records=[];try{const raw=localStorage.getItem(key);if(raw){const value=JSON.parse(raw);if(value.version!==1||!Array.isArray(value.records))throw Error();records=value.records;}}catch(_){compatible=false;}}
  const clone=v=>JSON.parse(JSON.stringify(v));
  function persist(){try{if(!compatible)throw Error();localStorage.setItem(key,JSON.stringify({version:1,records}));return {ok:true,message:'학습 기록을 저장했어요.'};}catch(_){return {ok:false,message:'현재 창에만 기록을 보관해요. 기존 저장 데이터는 유지했어요.'};}}
  const decimalStore={key,limit:100,available:()=>{load();return compatible;},list:()=>{load();return clone(records.filter(r=>r&&r.settings&&Array.isArray(r.wrongProblems)));},save:r=>{load();if(r.trainerId!=='decimal')return {ok:false,message:'학습 영역이 다릅니다.'};records=[clone(r),...records.filter(x=>x.id!==r.id)];return persist();},clear:()=>{load();records=[];compatible=true;return persist();},legacyCount:()=>{load();return records.filter(r=>!Array.isArray(r.wrongProblems)).length;}};
  root.TrainerAdapters={fraction:{id:'fraction',UI:root.FractionUI,math:root.FractionMath,bank:root.ProblemBank,store:root.LearningStorage},decimal:{id:'decimal',UI,math:D,bank:D,store:decimalStore,fields}};
  root.TrainerHistory={forTrainer:id=>root.TrainerAdapters[id||'fraction']?.store};
})(globalThis);
