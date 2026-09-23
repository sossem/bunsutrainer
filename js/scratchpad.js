/* Ephemeral, per-question ink. No storage or document-level input listeners. */
(function (root) {
  'use strict';
  let observer = null;
  function mount(session) {
    observer?.disconnect(); observer = null;
    if (!session) return;
    const stage = document.querySelector('.classroom-stage, .study-card');
    if (!stage) return;
    session.ink ||= {};
    const key = session.problems[session.index].id;
    const strokes = session.ink[key] ||= [];
    const wrapper = document.createElement('div');
    wrapper.className = 'scratch-layout';
    stage.replaceWith(wrapper); wrapper.append(stage);
    const panel = document.createElement('aside');
    panel.className = 'scratch-panel'; panel.setAttribute('aria-label', '문제 풀이 연습장');
    panel.innerHTML = `<button type="button" class="btn btn-quiet scratch-toggle" aria-controls="scratch-content">연습장</button><div id="scratch-content"><div class="scratch-tools"><button type="button" class="btn btn-small" data-ink="pen" aria-pressed="true">펜</button><button type="button" class="btn btn-small" data-ink="eraser" aria-pressed="false">지우개</button><button type="button" class="btn btn-small" data-ink="undo">되돌리기</button><button type="button" class="btn btn-small" data-ink="clear">모두 지우기</button></div><canvas aria-label="손가락, 터치펜 또는 마우스로 쓰는 연습장"></canvas><small>이 문제의 필기는 접거나 이전 문제로 이동해도 유지돼요.</small></div>`;
    wrapper.append(panel);
    const toggle = panel.querySelector('.scratch-toggle'), content = panel.querySelector('#scratch-content');
    const canvas = panel.querySelector('canvas'), ctx = canvas.getContext('2d');
    let pointer = null, stroke = null, eraser = false;
    function draw() {
      const r = canvas.getBoundingClientRect(), ratio = root.devicePixelRatio || 1;
      if (!r.width || !r.height) return;
      canvas.width = Math.round(r.width * ratio); canvas.height = Math.round(r.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const line of strokes) {
        ctx.globalCompositeOperation = line.erase ? 'destination-out' : 'source-over';
        ctx.strokeStyle = '#183c36'; ctx.lineWidth = line.erase ? 24 : 3;
        ctx.beginPath();
        line.points.forEach(([x, y], i) => i ? ctx.lineTo(x * r.width, y * r.height) : ctx.moveTo(x * r.width, y * r.height));
        if (line.points.length === 1) { const [x,y] = line.points[0]; ctx.lineTo(x*r.width+0.1,y*r.height); }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    function visibility() {
      const open = !!session.inkOpen;
      content.hidden = !open; wrapper.classList.toggle('scratch-open', open);
      toggle.setAttribute('aria-expanded', String(open)); toggle.textContent = open ? '연습장 접기' : '연습장 열기';
      draw();
    }
    toggle.addEventListener('click', () => { session.inkOpen = !session.inkOpen; visibility(); });
    panel.querySelector('.scratch-tools').addEventListener('click', event => {
      const action = event.target.closest('[data-ink]')?.dataset.ink;
      if (!action) return;
      if (action === 'clear') strokes.length = 0;
      if (action === 'undo') strokes.pop();
      if (action === 'pen' || action === 'eraser') eraser = action === 'eraser';
      for (const button of panel.querySelectorAll('[data-ink="pen"], [data-ink="eraser"]')) button.setAttribute('aria-pressed', String((button.dataset.ink === 'eraser') === eraser));
      draw();
    });
    function point(event) {
      const r = canvas.getBoundingClientRect();
      return [Math.max(0, Math.min(1, (event.clientX-r.left)/r.width)), Math.max(0, Math.min(1, (event.clientY-r.top)/r.height))];
    }
    canvas.addEventListener('pointerdown', event => {
      if (pointer !== null || event.button !== 0) return;
      event.preventDefault(); pointer = event.pointerId; canvas.setPointerCapture(pointer);
      stroke = { erase: eraser, points: [point(event)] }; strokes.push(stroke); draw();
    });
    canvas.addEventListener('pointermove', event => {
      if (pointer !== event.pointerId || !stroke) return;
      event.preventDefault(); stroke.points.push(point(event)); draw();
    });
    const end = event => { if (pointer === event.pointerId) { pointer = null; stroke = null; } };
    for (const event of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(event, end);
    visibility();
    observer = new ResizeObserver(draw); observer.observe(canvas);
  }
  root.Scratchpad = Object.freeze({ mount });
})(globalThis);
