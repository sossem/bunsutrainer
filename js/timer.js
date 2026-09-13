/* A monotonic, optional countdown. Rendering is supplied by the caller. */
(function (root) {
  'use strict';
  function validSeconds(seconds) {
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600) throw new RangeError('시간은 0 또는 1~3600초의 정수여야 해요.');
    return seconds;
  }
  function create(options = {}) {
    let seconds = validSeconds(options.seconds === undefined ? 0 : options.seconds);
    const now = options.now || (() => root.performance ? root.performance.now() : Date.now());
    const schedule = options.setInterval || root.setInterval.bind(root);
    const cancel = options.clearInterval || root.clearInterval.bind(root);
    const onTick = typeof options.onTick === 'function' ? options.onTick : () => {};
    const onExpire = typeof options.onExpire === 'function' ? options.onExpire : () => {};
    let remainingMs = seconds * 1000;
    let deadline = 0, interval = null, generation = 0;
    let running = false, expired = false, destroyed = false, expiryNotified = false;
    const left = () => running ? Math.max(0, Math.min(remainingMs, deadline - now())) : remainingMs;
    function snapshot() {
      const ms = left();
      return { enabled: seconds > 0, seconds, remaining: Math.ceil(ms / 1000), elapsedSeconds: Math.max(0, (seconds * 1000 - ms) / 1000), running: running && ms > 0, expired: expired || seconds > 0 && ms <= 0 };
    }
    function stopSchedule() {
      if (interval !== null) cancel(interval);
      interval = null;
      generation++;
    }
    function publishExpiration() {
      const token = generation;
      onTick(snapshot());
      // onTick may synchronously reset/destroy this timer or start a new question.
      if (!destroyed && expired && !expiryNotified && generation === token) {
        expiryNotified = true;
        onExpire(snapshot());
      }
    }
    function tick(token) {
      if (destroyed || !running || token !== generation) return;
      remainingMs = left();
      if (remainingMs <= 0) {
        running = false; expired = true; stopSchedule(); publishExpiration();
      } else onTick(snapshot());
    }
    function start() {
      if (destroyed || running || !seconds || expired) return snapshot();
      running = true; deadline = now() + remainingMs;
      const token = ++generation;
      interval = schedule(() => tick(token), 100);
      onTick(snapshot());
      return snapshot();
    }
    function pause() {
      if (destroyed || !running) return snapshot();
      remainingMs = left(); running = false; stopSchedule();
      if (remainingMs <= 0) { expired = true; publishExpiration(); }
      else onTick(snapshot());
      return snapshot();
    }
    function reset(nextSeconds = seconds) {
      const next = validSeconds(nextSeconds);
      if (destroyed) return snapshot();
      stopSchedule(); seconds = next; remainingMs = next * 1000;
      running = false; expired = false; expiryNotified = false;
      onTick(snapshot());
      return snapshot();
    }
    function destroy() {
      if (!destroyed) { remainingMs = left(); running = false; stopSchedule(); destroyed = true; }
      return snapshot();
    }
    return Object.freeze({ start, pause, reset, snapshot, destroy });
  }
  const api = Object.freeze({ create });
  root.StudyTimer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
