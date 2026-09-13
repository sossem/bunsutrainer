/* Code-native math and visual models. No network assets or HTML from user input. */
(function (root) {
  'use strict';
  const M = root.FractionMath;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icons = {
    arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>', back:'<path d="M19 12H5m5-5-5 5 5 5"/>',
    book:'<path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v14c-4-1-6 0-9 2-3-2-5-3-9-2z"/>',
    board:'<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5m-5 0 5-5 5 5M7 8h4m-4 4h10"/>',
    history:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6m3-3v5l3 2"/>',
    bulb:'<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2"/>',
    check:'<path d="m5 12 4 4L19 6"/>', full:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    refresh:'<path d="M20 9a8 8 0 0 0-14-4L3 8m0-5v5h5m-4 7a8 8 0 0 0 14 4l3-3m0 5v-5h-5"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v.1"/>',
    chart:'<path d="M3 20h18M6 16V9m6 7V4m6 12v-5"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
    steps:'<path d="M9 6h12M9 12h12M9 18h12M3 6h1m-1 6h1m-1 6h1"/>',
  };
  function icon(name) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.book}</svg>`; }
  function fraction(f, mixed = false) {
    if (typeof f === 'number') return `<span class="whole">${esc(f)}</span>`;
    if (!f || typeof f !== 'object') return esc(f);
    const explicitWhole = Object.prototype.hasOwnProperty.call(f, 'whole');
    let whole = explicitWhole ? f.whole : 0, n = f.n, d = f.d;
    // Teaching tokens can deliberately show 0 + 7/6 after borrowing, or 3/1.
    // Preserve that written form; only unmarked problem/answer values become mixed.
    if (mixed && !explicitWhole && !f.forceFraction && Number.isInteger(n) && n >= d) { whole = Math.floor(n / d); n %= d; }
    if (n === 0 && !f.forceFraction) return `<span class="whole">${esc(whole)}</span>`;
    if (d === 1 && Number.isInteger(n) && !f.forceFraction) return `<span class="whole">${esc(whole + n)}</span>`;
    const num = n === '□' ? '<span class="math-blank">?</span>' : esc(n);
    return `<span class="mixed-number" role="math" aria-label="${whole ? esc(whole) + '과 ' : ''}${esc(d)}분의 ${n === '□' ? '빈칸' : esc(n)}">${whole ? `<span class="whole">${esc(whole)}</span>` : ''}<span class="fraction"><span class="numerator">${num}</span><span class="denominator">${esc(d)}</span></span></span>`;
  }
  function token(t, mixed = false) {
    if (typeof t === 'object' || typeof t === 'number') return fraction(t, mixed);
    if (typeof t === 'string' && /^-?\d+$/.test(t)) return `<span class="whole">${esc(t)}</span>`;
    if (['+','-','−','×','÷','=','<','>','→',':','(',')'].includes(t)) return `<span class="math-operator">${esc(t === '-' ? '−' : t)}</span>`;
    if (t === '□' || t === '?') return '<span class="math-blank">?</span>';
    return `<span class="math-word">${esc(t)}</span>`;
  }
  const tokens = (items, mixed = false) => items.map(t => token(t, mixed)).join('');
  function equation(p) {
    if (p.kind === 'equivalent') return tokens([p.operands[0], '=', {n:'□',d:p.targetDen}]);
    if (p.kind === 'compare') return tokens([p.operands[0], '□', p.operands[1]], true);
    if (p.kind === 'common' || p.kind === 'common-denominator') return tokens([p.operands[0], '와', p.operands[1]], true);
    if (p.kind === 'simplify') return fraction(p.operands[0]);
    return tokens([p.operands[0], p.operator, p.operands[1]], true);
  }
  function answer(p) {
    if (Array.isArray(p.answer)) return tokens([p.answer[0], '와', p.answer[1]]);
    return token(p.answer, true);
  }
  function bars(fs, showCaption = true) {
    const whole = Math.max(1, ...fs.map(f => Math.ceil(f.n / f.d)));
    const detailed = whole <= 12 && fs.every(f => f.d <= 72);
    const rows = fs.map(f => {
      let contents;
      if (detailed) {
        // Whole units do not need dozens of repeated fraction subdivisions.
        // Only the partly filled unit is partitioned, without changing the scale.
        const full = Math.floor(f.n / f.d), remainder = f.n % f.d;
        contents = Array.from({ length: whole }, (_, unit) => {
          const partial = unit === full && remainder > 0;
          const cells = partial ? f.d : 1;
          return `<span class="bar-unit" style="display:grid;min-width:0;grid-template-columns:repeat(${cells},minmax(0,1fr));${unit ? 'border-left:3px solid #1f5b3d;' : ''}">${Array.from({ length: cells }, (_, i) => `<i class="bar-cell${unit < full || partial && i < remainder ? ' filled' : ''}"></i>`).join('')}</span>`;
        }).join('');
      } else {
        const percent = Math.max(0, Math.min(100, f.n / f.d / whole * 100));
        contents = `<i class="bar-cell" style="background:linear-gradient(to right,#3a8d70 ${percent}%,#f7faf6 ${percent}%);"></i>`;
      }
      return `<div class="model-row"><div class="math-line">${fraction(f,true)}</div><div class="fraction-bar" role="img" aria-label="막대 전체 길이 ${whole}, ${f.d}분의 ${f.n}만큼 색칠" style="--parts:${detailed ? whole : 1}">${contents}</div></div>`;
    }).join('');
    return rows + (showCaption ? `<p class="visual-caption">두 막대의 전체 길이는 모두 ${whole}입니다. ${detailed ? '굵은 선은 자연수 1의 경계예요.' : '양을 비교하기 쉽도록 세부 눈금은 생략했어요.'}</p>` : '');
  }
  function circles(fs) {
    return `<div class="circle-models">${fs.map(f => `<div class="circle-item"><svg viewBox="0 0 200 200" role="img" aria-label="${f.d}조각 중 ${f.n}조각">${Array.from({length:f.d},(_,i)=>{const a=2*Math.PI*i/f.d-Math.PI/2,b=2*Math.PI*(i+1)/f.d-Math.PI/2;return `<path d="M100 100L${100+90*Math.cos(a)} ${100+90*Math.sin(a)} A90 90 0 ${b-a>Math.PI?1:0} 1 ${100+90*Math.cos(b)} ${100+90*Math.sin(b)}Z" fill="${i<f.n?'#83b49a':'#fff'}" stroke="#244e3e" stroke-width="2"/>`;}).join('')}</svg><div class="math-line">${fraction(f)}</div></div>`).join('')}</div><p class="visual-caption">같은 크기의 원 하나가 1입니다. 똑같이 나눈 조각을 살펴보세요.</p>`;
  }
  function area(a,b) {
    const cells=[];for(let y=0;y<b.d;y++)for(let x=0;x<a.d;x++)cells.push(`<rect x="${x*240/a.d}" y="${y*180/b.d}" width="${240/a.d}" height="${180/b.d}" fill="${x<a.n&&y<b.n?'#226f60':x<a.n?'#c4dbc8':y<b.n?'#f4dfa2':'#fff'}" stroke="#627f6b" stroke-width="1"/>`);
    return `<div class="area-model"><svg viewBox="-1 -1 242 182" role="img" aria-label="${a.d*b.d}칸 중 겹치는 ${a.n*b.n}칸">${cells.join('')}</svg><div class="area-legend"><span><i class="legend-mark" style="background:#c4dbc8"></i>가로로 ${a.d}등분한 것 중 ${a.n}칸</span><span><i class="legend-mark" style="background:#f4dfa2"></i>세로로 ${b.d}등분한 것 중 ${b.n}칸</span><strong><i class="legend-mark" style="background:#226f60"></i>겹친 부분 ${a.n*b.n}칸 / 전체 ${a.d*b.d}칸</strong></div></div><p class="visual-caption">전체 사각형은 1입니다. 두 분수만큼 선택했을 때 겹치는 부분이 곱이에요.</p>`;
  }
  function numberLine(fs) {
    const whole=Math.max(1,...fs.map(f=>Math.ceil(f.n/f.d))), labels=fs.map((f,i)=>{const x=65+770*f.n/f.d/whole;return `<circle cx="${x}" cy="80" r="8" fill="${i?'#ac6b1b':'#226f60'}"/><text x="${x}" y="${i?130:35}" text-anchor="middle" font-size="29" font-weight="700" fill="#183c36">${f.n}/${f.d}</text>`;}).join('');
    return `<svg class="number-line-svg" viewBox="0 0 900 155" role="img" aria-label="0부터 ${whole}까지 수직선에서 두 분수의 위치"><path d="M65 80H835" stroke="#183c36" stroke-width="4"/>${Array.from({length:whole+1},(_,i)=>`<path d="M${65+770*i/whole} 69v22" stroke="#183c36" stroke-width="3"/><text x="${65+770*i/whole}" y="110" text-anchor="middle" font-size="20" fill="#52685b">${i}</text>`).join('')}${labels}</svg><p class="visual-caption">오른쪽에 있는 수가 더 큽니다. 같은 위치에 있으면 크기가 같아요.</p>`;
  }
  function visual(p, mode) {
    const v=p.visual || {kind:'bars',fractions:p.operands};
    let fs=v.fractions || [v.a,v.b].filter(Boolean);
    if (!fs.length) fs=p.operands;
    if (mode==='circle' && fs.every(f=>f.n<=f.d && f.d>1)) return circles(fs);
    if (mode==='number-line') return numberLine(fs);
    if (v.kind==='area') return area(v.a,v.b);
    if (v.kind==='division') {
      const d=M.lcm(v.a.d,v.b.d),a=v.a.n*d/v.a.d,b=v.b.n*d/v.b.d;
      return `<div class="math-line visual-math"><span class="math-word">같은 크기의 조각으로 세면</span>${tokens([a,'÷',b])}</div>${bars([v.a,v.b],false)}<p class="visual-caption">${d}분의 1 조각 ${a}개에 ${b}개짜리 묶음이 몇 묶음 들어갈까요? 묶음의 일부도 분수로 나타내요.<br>두 막대에서 자연수 1의 길이는 같고, 굵은 선은 1의 경계예요.</p>`;
    }
    return bars(fs);
  }
  function visualOptions(p) {
    const v=p.visual || {},fs=v.fractions || p.operands;
    if(v.kind==='area'||v.kind==='division')return [];
    return [{id:'bars',label:'분수 막대'},...(fs.every(f=>f.n<=f.d&&f.d>1)?[{id:'circle',label:'원 모델'}]:[]),{id:'number-line',label:'수직선'}];
  }
  root.FractionUI={esc,icon,fraction,tokens,equation,answer,visual,visualOptions};
})(globalThis);
