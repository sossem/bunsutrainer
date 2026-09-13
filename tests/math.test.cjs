const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../js/fraction.js');
const f = (n, d = 1) => ({ n, d });
const answer = (num, den, whole = '') => ({ whole, num: String(num), den: String(den) });

test('약분: 6/8 → 3/4; zero and normalized signs', () => {
  assert.deepEqual(M.simplifyFraction(f(6, 8)), f(3, 4));
  assert.deepEqual(M.simplifyFraction(f(0, 8)), f(0));
  assert.deepEqual(M.simplifyFraction(f(-6, -8)), f(3, 4));
  assert.deepEqual(M.simplifyFraction(f(6, -8)), f(-3, 4));
});

test('통분: 1/2, 1/3 → 3/6, 2/6 without reducing intermediate values', () => {
  assert.deepEqual(M.commonDenominator(f(1, 2), f(1, 3)), [f(3, 6), f(2, 6)]);
  assert.deepEqual(M.commonDenominator(f(2, 4), f(1, 6)), [f(6, 12), f(2, 12)]);
  assert.equal(M.gcd(-12, 18), 6);
  assert.equal(M.gcd(0, 0), 0);
  assert.equal(M.lcm(4, 6), 12);
  assert.equal(M.lcm(-4, 6), 12);
  assert.equal(M.lcm(0, 6), 0);
});

test('덧셈: 1/3 + 1/6 = 1/2', () => {
  assert.deepEqual(M.addFractions(f(1, 3), f(1, 6)), f(1, 2));
});

test('뺄셈: 3/4 - 1/6 = 7/12; equal values give zero', () => {
  assert.deepEqual(M.subtractFractions(f(3, 4), f(1, 6)), f(7, 12));
  assert.deepEqual(M.subtractFractions(f(1, 2), f(2, 4)), f(0));
  assert.deepEqual(M.subtractFractions(f(1, 6), f(3, 4)), f(-7, 12));
});

test('곱셈: 2/3 × 3/4 = 1/2', () => {
  assert.deepEqual(M.multiplyFractions(f(2, 3), f(3, 4)), f(1, 2));
});

test('나눗셈: 2/3 ÷ 4/5 = 5/6', () => {
  assert.deepEqual(M.divideFractions(f(2, 3), f(4, 5)), f(5, 6));
  assert.deepEqual(M.divideFractions(f(0, 3), f(4, 5)), f(0));
});

test('대분수 ↔ 가분수 conversion including integers, zero and signed remainder', () => {
  assert.deepEqual(M.mixedToImproper(2, 1, 3), f(7, 3));
  assert.deepEqual(M.improperToMixed(f(7, 3)), { whole: 2, n: 1, d: 3 });
  assert.deepEqual(M.improperToMixed(f(12, 3)), { whole: 4, n: 0, d: 1 });
  assert.deepEqual(M.mixedToImproper(0, 0, 5), f(0));
  for (let n = -50; n <= 50; n++) {
    for (let d = 1; d <= 12; d++) {
      const mixed = M.improperToMixed(f(n, d));
      assert.deepEqual(M.mixedToImproper(mixed.whole, mixed.n, mixed.d), M.simplifyFraction(f(n, d)));
    }
  }
});

test('동치분수: 1/2 = 2/4 = 3/6 and exact comparison', () => {
  assert.ok(M.equivalentFractions(f(1, 2), f(2, 4)));
  assert.ok(M.equivalentFractions(f(2, 4), f(3, 6)));
  assert.equal(M.compareFractions(f(3, 4), f(5, 8)), 1);
  assert.equal(M.compareFractions(f(3, 8), f(1, 2)), -1);
  assert.equal(M.compareFractions(f(1, 2), f(4, 8)), 0);
});

test('Reject zero denominator, division by zero, unsafe and noninteger values', () => {
  assert.throws(() => M.simplifyFraction(f(1, 0)), /분모/);
  assert.throws(() => M.divideFractions(f(1, 2), f(0, 3)), /0으로/);
  assert.throws(() => M.addFractions(f(1.5, 2), f(1, 2)), TypeError);
  assert.throws(() => M.gcd(NaN, 2), TypeError);
  assert.throws(() => M.gcd(Infinity, 2), TypeError);
  assert.throws(() => M.simplifyFraction(f(Number.MAX_SAFE_INTEGER + 1, 2)), TypeError);
  assert.throws(() => M.multiplyFractions(f(Number.MAX_SAFE_INTEGER), f(2)), RangeError);
});

test('BigInt intermediates preserve exact answers when cross products exceed safe range', () => {
  const large = Number.MAX_SAFE_INTEGER;
  assert.equal(M.compareFractions(f(large - 1, large), f(large - 2, large - 1)), 1);
  assert.deepEqual(M.multiplyFractions(f(large, large - 1), f(large - 1, large)), f(1));
  assert.deepEqual(M.subtractFractions(f(large, 3), f(large, 3)), f(0));
});

test('Arithmetic inverse identities over grade-appropriate fractions', () => {
  for (let ad = 2; ad <= 12; ad++) {
    for (let bd = 2; bd <= 12; bd++) {
      const a = f(ad - 1, ad), b = f(bd - 1, bd);
      assert.ok(M.equivalentFractions(M.subtractFractions(M.addFractions(a, b), b), a));
      assert.ok(M.equivalentFractions(M.divideFractions(M.multiplyFractions(a, b), b), a));
      const [left, right] = M.commonDenominator(a, b);
      assert.equal(left.d, right.d);
      assert.ok(M.equivalentFractions(left, a));
      assert.ok(M.equivalentFractions(right, b));
    }
  }
});

test('Parser accepts integer, fraction, mixed number, zero and leading/trailing whitespace', () => {
  assert.deepEqual(M.parseAnswer({ whole: '2' }).value, f(2));
  assert.deepEqual(M.parseAnswer(answer(6, 8)).value, f(3, 4));
  assert.deepEqual(M.parseAnswer(answer(1, 3, '2')).value, f(7, 3));
  assert.deepEqual(M.parseAnswer(answer(0, 2)).value, f(0));
  assert.deepEqual(M.parseAnswer({ num: ' 1 ', den: ' 2 ' }).value, f(1, 2));
  assert.deepEqual(M.parseAnswer(answer(2, 4)).raw, f(2, 4));
});

test('Parser rejects blank, partial, decimal, negative, exponent, overflow, zero denominator', () => {
  for (const input of [null, {}, { whole: ' ' }, { num: '1' }, { den: '2' },
    answer(0, 0), answer(1, 0), answer(-1, 2), answer(1.5, 2),
    answer('1e2', 3), answer('Infinity', 3), answer('1x', 3), answer(10001, 3),
    { whole: '-1' }, { whole: '1', num: '2', den: '' }]) {
    assert.equal(M.parseAnswer(input).valid, false, JSON.stringify(input));
  }
});

test('Ordinary calculation accepts every equivalent representation', () => {
  const problem = { kind: 'calculation', answer: f(1, 2) };
  for (const [n, d] of [[1, 2], [2, 4], [3, 6], [5000, 10000]]) {
    assert.equal(M.gradeAnswer(problem, answer(n, d)).correct, true);
  }
  assert.equal(M.gradeAnswer({ kind: 'calculation', answer: f(7, 3) }, answer(1, 3, '2')).correct, true);
  assert.equal(M.gradeAnswer({ kind: 'calculation', answer: f(3) }, { whole: '3' }).correct, true);
});

test('Reduced answer checks raw input and teaches reduction without calling value wrong', () => {
  const problem = { kind: 'simplify', answer: f(3, 4), requireReduced: true };
  assert.equal(M.gradeAnswer(problem, answer(6, 8)).code, 'needs-reduction');
  assert.equal(M.gradeAnswer(problem, answer(3, 4)).correct, true);
  assert.equal(M.gradeAnswer({ kind: 'calculation', answer: f(3, 2), requireReduced: true }, answer(2, 4, '1')).code, 'needs-reduction');
});

test('Compare, equivalent numerator and least common denominator checks', () => {
  assert.equal(M.gradeAnswer({ kind: 'compare', answer: '>' }, '>').correct, true);
  assert.equal(M.gradeAnswer({ kind: 'compare', answer: '>' }, { symbol: '<' }).code, 'comparison');
  assert.equal(M.gradeAnswer({ kind: 'compare', answer: '>' }, '').valid, false);
  assert.equal(M.gradeAnswer({ kind: 'equivalent', answer: 6 }, { integer: '6' }).correct, true);
  assert.equal(M.gradeAnswer({ kind: 'common-denominator', answer: 6 }, '12').code, 'common-denominator');
  assert.equal(M.gradeAnswer({ kind: 'common-denominator', answer: 6 }, '6').correct, true);
  assert.equal(M.gradeAnswer({ kind: 'equivalent', answer: 6 }, { integer: '6.0' }).valid, false);
});

test('Common denominator checks values, denominator and both fraction entries', () => {
  const problem = { kind: 'common', answer: [f(3, 6), f(2, 6)], targetDen: 6 };
  assert.equal(M.gradeAnswer(problem, [answer(3, 6), answer(2, 6)]).correct, true);
  assert.equal(M.gradeAnswer(problem, { fractions: [answer(3, 6), answer(2, 6)] }).correct, true);
  assert.equal(M.gradeAnswer(problem, [answer(1, 2), answer(1, 3)]).code, 'target-denominator');
  assert.equal(M.gradeAnswer(problem, [answer(2, 6), answer(2, 6)]).code, 'common-denominator');
  assert.equal(M.gradeAnswer(problem, [answer(3, 6)]).valid, false);
});

test('Feedback identifies adding denominators and incorrect common numerators', () => {
  const problem = { kind: 'calculation', operands: [f(1, 3), f(1, 6)], operator: '+', answer: f(1, 2) };
  assert.equal(M.gradeAnswer(problem, answer(2, 9)).code, 'add-denominators');
  assert.equal(M.gradeAnswer(problem, answer(2, 6)).code, 'common-denominator');
  assert.equal(M.gradeAnswer(problem, answer(5, 6)).code, 'calculation');
});

test('Feedback identifies reciprocal and mixed conversion mistakes', () => {
  const division = { kind: 'calculation', operands: [f(2, 3), f(4, 5)], operator: '÷', answer: f(5, 6) };
  assert.equal(M.gradeAnswer(division, answer(8, 15)).code, 'reciprocal');
  assert.equal(M.gradeAnswer(division, answer(6, 5)).code, 'reciprocal');
  const mixed = { kind: 'calculation', operands: [f(8, 3), f(1, 3)], operator: '+', answer: f(3) };
  assert.equal(M.gradeAnswer(mixed, answer(5, 3)).code, 'mixed-conversion');
});

const storageSource = fs.readFileSync(path.join(__dirname, '../js/storage.js'), 'utf8');
function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); }
  };
}
function loadStorage(storage) {
  const context = vm.createContext({ localStorage: storage });
  vm.runInContext(storageSource, context);
  return context.LearningStorage;
}
function record(id = 'session-1') {
  return { id, date: '2026-09-12T01:02:03.000Z', settings: { mode: 'personal', grade: 5 }, total: 10, correct: 8, firstCorrect: 6, durationSeconds: 90, wrongProblems: [{ id: 'problem-1', kind: 'calculation', answer: f(1, 2) }], attempts: [] };
}

test('Storage saves a complete record, survives reload and remains idempotent', () => {
  const local = fakeStorage(), store = loadStorage(local);
  assert.equal(store.available(), true);
  assert.equal(store.save(record()).ok, true);
  assert.equal(store.save({ ...record(), correct: 9 }).ok, true);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].correct, 9);
  assert.equal(loadStorage(local).list()[0].wrongProblems[0].answer.d, 2);
});

test('Storage bounds history at 100 and returns detached data', () => {
  const store = loadStorage(fakeStorage());
  for (let i = 0; i < 105; i++) assert.equal(store.save(record(`session-${i}`)).ok, true);
  assert.equal(store.list().length, 100);
  assert.equal(store.list()[0].id, 'session-104');
  assert.equal(store.list()[99].id, 'session-5');
  const history = store.list();
  history[0].correct = 0;
  assert.equal(store.list()[0].correct, 8);
});

test('Storage rejects invalid records without corrupting saved history', () => {
  const store = loadStorage(fakeStorage());
  store.save(record());
  for (const invalid of [{ ...record(), correct: 11 }, { ...record(), date: 'bad-date' }, { ...record(), durationSeconds: -1 }, { ...record(), firstCorrect: 9 }, { ...record(), settings: [] }]) {
    assert.equal(store.save(invalid).ok, false);
  }
  assert.equal(store.list().length, 1);
});

test('Denied or quota storage still retains records in memory and reports save limitation', () => {
  for (const local of [undefined, { getItem() { throw new Error('denied'); } }, { getItem() { return null; }, setItem() { throw new Error('quota'); }, removeItem() {} }]) {
    const store = loadStorage(local);
    assert.equal(store.available(), false);
    const saved = store.save(record());
    assert.equal(saved.ok, false);
    assert.ok(saved.message.length > 0);
    assert.equal(store.list().length, 1);
    store.save(record('session-2'));
    assert.equal(store.list().length, 2);
  }
});

test('Malformed or unknown-version storage is preserved and explicit clear recovers it', () => {
  for (const raw of ['broken JSON', '{"version":99,"records":[]}', '{"version":1,"records":null}']) {
    const local = fakeStorage({ 'bunsu.learning.v1': raw }), store = loadStorage(local);
    assert.equal(store.list().length, 0);
    assert.equal(store.save(record()).ok, false);
    assert.equal(local.getItem(store.key), raw);
    assert.equal(store.list().length, 1);
    assert.equal(store.clear().ok, true);
    assert.equal(store.list().length, 0);
    assert.equal(store.save(record()).ok, true);
  }
});

test('Storage loads valid records while filtering invalid and duplicate entries', () => {
  const local = fakeStorage({ 'bunsu.learning.v1': JSON.stringify({ version: 1, records: [record(), { nonsense: true }, record(), record('session-2')] }) });
  const store = loadStorage(local);
  assert.equal(store.list().length, 2);
  assert.equal(store.clear().ok, true);
  assert.equal(loadStorage(local).list().length, 0);
});
