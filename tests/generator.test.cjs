const test = require('node:test');
const assert = require('node:assert/strict');
require('../js/fraction.js');
const Bank = require('../js/problem-generator.js');

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return Math.abs(a); }
function lcd(a, b) { return a / gcd(a, b) * b; }
function equal(a, b) { return BigInt(a.n) * BigInt(b.d) === BigInt(b.n) * BigInt(a.d); }
function calc(a, op, b) {
  if (op === '+') return { n: a.n * b.d + b.n * a.d, d: a.d * b.d };
  if (op === '-') return { n: a.n * b.d - b.n * a.d, d: a.d * b.d };
  if (op === '×') return { n: a.n * b.n, d: a.d * b.d };
  if (op === '÷') return { n: a.n * b.d, d: a.d * b.n };
  throw new Error(`Unexpected operator ${op}`);
}
function value(token) {
  if (token && typeof token === 'object' && Number.isInteger(token.n) && Number.isInteger(token.d)) {
    assert.ok(token.d > 0);
    assert.ok(token.n >= 0);
    if ('whole' in token) {
      assert.ok(Number.isInteger(token.whole) && token.whole >= 0);
      return { n: token.whole * token.d + token.n, d: token.d };
    }
    return token;
  }
  if (typeof token === 'number' || (typeof token === 'string' && /^\d+$/.test(token))) return { n: Number(token), d: 1 };
  return null;
}
function expression(tokens) {
  if (tokens.length === 1) return value(tokens[0]);
  if (tokens.length !== 3) return null;
  const a = value(tokens[0]), b = value(tokens[2]);
  return a && b && ['+', '-', '×', '÷'].includes(tokens[1]) ? calc(a, tokens[1], b) : null;
}
function verifySteps(problem) {
  assert.ok(problem.hint.length > 0);
  assert.ok(problem.steps.length > 0);
  for (const step of problem.steps) {
    assert.ok(step.title && step.text);
    const tokens = step.tokens || [];
    for (const token of tokens) value(token);
    const eq = tokens.indexOf('=');
    if (eq < 0) continue;
    const left = expression(tokens.slice(0, eq));
    const right = expression(tokens.slice(eq + 1));
    if (left && right) assert.ok(equal(left, right), `Invalid explanation in ${problem.unit}/${problem.type}: ${JSON.stringify(step)}`);
  }
}
function verifyProblem(problem) {
  assert.ok(problem.id && problem.signature && problem.prompt && problem.typeLabel);
  for (const f of problem.operands) {
    assert.ok(Number.isInteger(f.n) && f.n > 0);
    assert.ok(Number.isInteger(f.d) && f.d > 0);
  }
  const [a, b] = problem.operands;
  if (problem.kind === 'calculation') {
    const expected = calc(a, problem.operator, b);
    assert.ok(equal(problem.answer, expected), `${problem.unit}/${problem.type} incorrect arithmetic`);
    assert.ok(problem.answer.n > 0 && problem.answer.n / problem.answer.d <= 24);
    assert.ok(problem.answer.d <= 60 && problem.answer.n <= 240);
    if (problem.requireReduced) assert.equal(gcd(problem.answer.n, problem.answer.d), 1);
    assert.equal(problem.requireReduced, problem.grade !== 4);
    if (problem.grade === 4 && !['one-minus', 'whole-minus-mixed'].includes(problem.type)) assert.equal(a.d, b.d);
    if (problem.unit === 'g5-addsub') assert.notEqual(a.d, b.d);
    if (problem.type === 'proper-add') {
      assert.ok(a.n < a.d && b.n < b.d);
      if (problem.grade === 4) assert.ok(problem.answer.n <= problem.answer.d);
    }
    if (problem.type === 'improper-add') assert.ok(a.n < a.d && b.n < b.d && problem.answer.n > problem.answer.d);
    if (problem.type === 'proper-sub') assert.ok(a.n < a.d && b.n < b.d);
    if (problem.type === 'one-minus') assert.ok(equal(a, { n: 1, d: 1 }));
    if ((problem.type.includes('mixed') && !['mixed-divide', 'whole-minus-mixed'].includes(problem.type)) || problem.type === 'borrow') assert.ok(a.n > a.d && a.n % a.d !== 0);
    if (problem.type === 'mixed-divide') assert.ok(a.n > a.d && a.n % a.d !== 0 || b.n > b.d && b.n % b.d !== 0);
    if (problem.type === 'mixed-add' || problem.type === 'mixed-sub') assert.ok(b.n > b.d && b.n % b.d !== 0);
    if (problem.type === 'whole-minus-mixed') {
      assert.equal(a.d, 1);
      assert.ok(a.n >= 2 && b.n > b.d && b.n % b.d !== 0);
      assert.equal(problem.operator, '-');
      assert.equal(problem.borrowing, true);
    }
    if (problem.type === 'borrow' || problem.type === 'whole-minus-mixed') {
      assert.ok((a.n % a.d) * b.d < (b.n % b.d) * a.d);
      assert.ok(problem.steps.some(step => step.title.includes('받아내리기')));
    }
    if (problem.type === 'cancellation') {
      assert.ok(gcd(a.n, b.d) > 1 || gcd(b.n, a.d) > 1);
      assert.ok(problem.steps.some(step => step.title.includes('곱하기 전에 약분')));
    }
  } else if (problem.kind === 'equivalent') {
    assert.ok(equal(a, { n: problem.answer, d: problem.targetDen }));
  } else if (problem.kind === 'simplify') {
    assert.ok(equal(a, problem.answer));
    assert.equal(gcd(problem.answer.n, problem.answer.d), 1);
    assert.ok(gcd(a.n, a.d) > 1);
    assert.equal(problem.requireReduced, true);
  } else if (problem.kind === 'common-denominator') {
    assert.equal(problem.answer, lcd(a.d, b.d));
  } else if (problem.kind === 'common') {
    assert.equal(problem.targetDen, lcd(a.d, b.d));
    problem.answer.forEach((f, i) => {
      assert.ok(equal(f, problem.operands[i]));
      assert.equal(f.d, problem.targetDen);
    });
  } else if (problem.kind === 'compare') {
    const delta = a.n * b.d - b.n * a.d;
    assert.equal(problem.answer, delta < 0 ? '<' : delta > 0 ? '>' : '=');
  } else assert.fail(`Unknown kind: ${problem.kind}`);
  verifySteps(problem);
}

test('curriculum covers every requested grade and topic', () => {
  assert.deepEqual(Bank.curriculum.map(item => item.grade), [4, 5, 6]);
  assert.deepEqual(Bank.curriculum.map(item => item.units.length), [1, 3, 1]);
  assert.deepEqual(Bank.curriculum.flatMap(item => item.units.map(unit => unit.types.length)), [7, 6, 7, 5, 4]);
});

for (const grade of Bank.curriculum) {
  for (const unit of grade.units) {
    for (const type of unit.types) {
      test(`${grade.grade}학년 ${unit.id}/${type.id}: all difficulties, exact answers and truthful steps`, () => {
        for (const difficulty of ['easy', 'normal', 'challenge']) {
          const rng = seeded(grade.grade * 3109 + type.id.length * 97 + difficulty.length);
          for (let i = 0; i < 80; i++) {
            const p = Bank.generateProblem({ grade: grade.grade, unit: unit.id, type: type.id, difficulty }, rng);
            verifyProblem(p);
            if (p.kind === 'calculation') {
              assert.ok(p.answer.d <= (difficulty === 'easy' ? 24 : difficulty === 'normal' ? 48 : 60));
            }
          }
        }
      });
      test(`${unit.id}/${type.id}: 20 unique questions and avoid previous set`, () => {
        const rng = seeded(19201080 + type.id.length);
        const settings = { grade: grade.grade, unit: unit.id, type: type.id, difficulty: 'normal', count: 20 };
        const first = Bank.generateSet(settings, [], rng);
        const second = Bank.generateSet(settings, first, rng);
        assert.equal(first.length, 20);
        assert.equal(second.length, 20);
        assert.equal(new Set(first.map(p => p.signature)).size, 20);
        assert.equal(new Set(second.map(p => p.signature)).size, 20);
        assert.equal(new Set([...first, ...second].map(p => p.signature)).size, 40);
      });
    }
  }
}

test('all-type sets balance types and apply mixed-number and borrowing filters', () => {
  for (const grade of Bank.curriculum) {
    for (const unit of grade.units) {
      for (const includeMixed of [false, true]) {
        const settings = { grade: grade.grade, unit: unit.id, type: 'all', count: 20, includeMixed, includeBorrow: false };
        const result = Bank.generateSet(settings, [], seeded(1020));
        const counts = new Map();
        for (const p of result) {
          const type = unit.types.find(t => t.id === p.type);
          if (!includeMixed) assert.ok(!type.mixed);
          assert.ok(!type.borrow);
          if (p.operator === '-' && p.type !== 'one-minus') assert.equal(p.borrowing, false);
          counts.set(p.type, (counts.get(p.type) || 0) + 1);
          verifyProblem(p);
        }
        assert.ok(Math.max(...counts.values()) - Math.min(...counts.values()) <= 1);
      }
    }
  }
});

test('explicit mixed and borrowing types work even when all-type inclusion options are off', () => {
  const p = Bank.generateProblem({ grade: 5, unit: 'g5-addsub', type: 'borrow', includeMixed: false, includeBorrow: false }, seeded(34));
  assert.equal(p.borrowing, true);
  verifyProblem(p);
});

test('addition and subtraction groups keep operation, filters, balance, and unique sets', () => {
  for (const grade of [4, 5]) {
    const unit = Bank.getUnit(grade, `g${grade}-addsub`);
    for (const [type, operator] of [['addition', '+'], ['subtraction', '-']]) {
      for (const difficulty of ['easy', 'normal', 'challenge']) {
        for (const includeMixed of [false, true]) {
          for (const includeBorrow of [false, true]) {
            const settings = { grade, unit: unit.id, type, difficulty, count: 20, includeMixed, includeBorrow };
            const rng = seeded(45406);
            const single = Bank.generateProblem(settings, rng);
            const first = Bank.generateSet(settings, [], rng);
            const second = Bank.generateSet(settings, first, rng);
            for (const problem of [single, ...first, ...second]) {
              verifyProblem(problem);
              assert.equal(problem.operator, operator);
              const actualType = unit.types.find(item => item.id === problem.type);
              if (!includeMixed) assert.ok(!actualType.mixed);
              if (!includeBorrow) {
                assert.ok(!actualType.borrow);
                if (operator === '-' && problem.type !== 'one-minus') assert.equal(problem.borrowing, false);
              }
            }
            assert.equal(first.length, 20);
            assert.equal(second.length, 20);
            assert.equal(new Set([...first, ...second].map(problem => problem.signature)).size, 40);
            for (const set of [first, second]) {
              const counts = [...new Set(set.map(problem => problem.type))].map(id => set.filter(problem => problem.type === id).length);
              assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
            }
          }
        }
      }
    }
  }
});

test('operation groups preserve reduction and bounded fallback and reject other units', () => {
  for (const grade of [4, 5]) {
    for (const type of ['addition', 'subtraction']) {
      const set = Bank.generateSet({ grade, unit: `g${grade}-addsub`, type, count: 20, requireReduction: true }, [], () => 0);
      assert.equal(new Set(set.map(problem => problem.signature)).size, 20);
      for (const problem of set) {
        verifyProblem(problem);
        assert.ok(gcd(problem.raw.n, problem.raw.d) > 1);
      }
    }
  }
  for (const [grade, unit] of [[5, 'g5-equivalence'], [5, 'g5-multiply'], [6, 'g6-divide']]) {
    for (const type of ['addition', 'subtraction']) {
      assert.throws(() => Bank.generateProblem({ grade, unit, type }), /문제 유형/);
      assert.throws(() => Bank.generateSet({ grade, unit, type }), /문제 유형/);
    }
  }
});

test('legacy natural minus mixed problems retain borrowing steps and natural-number display', () => {
  require('../js/ui.js');
  for (const difficulty of ['easy', 'normal', 'challenge']) {
    const problems = Bank.generateSet({ grade: 4, unit: 'g4-addsub', type: 'whole-minus-mixed', difficulty, count: 20, includeMixed: false, includeBorrow: false }, [], seeded(4006));
    for (const problem of problems) {
      verifyProblem(problem);
      const [natural, mixed] = problem.operands;
      assert.ok(equal(calc(problem.answer, '+', mixed), natural));
      const equation = globalThis.FractionUI.equation(problem);
      assert.ok(equation.startsWith(`<span class="whole">${natural.n}</span>`));
      assert.ok(!equation.includes('undefined') && !equation.includes('NaN'));
    }
  }
});

test('requireReduction guarantees a reducible intermediate for every arithmetic type', () => {
  for (const grade of Bank.curriculum) {
    for (const unit of grade.units.filter(unit => unit.id !== 'g5-equivalence')) {
      for (const type of unit.types) {
        for (const difficulty of ['easy', 'normal', 'challenge']) {
          const rng = seeded(405060 + type.id.length);
          for (let i = 0; i < 20; i++) {
            const p = Bank.generateProblem({ grade: grade.grade, unit: unit.id, type: type.id, difficulty, requireReduction: true }, rng);
            assert.ok(gcd(p.raw.n, p.raw.d) > 1);
            verifyProblem(p);
          }
        }
      }
    }
  }
});

test('bounded fallback still produces unique questions with a constant random source', () => {
  for (const unit of Bank.curriculum.flatMap(grade => grade.units)) {
    const grade = Bank.curriculum.find(item => item.units.includes(unit)).grade;
    const set = Bank.generateSet({ grade, unit: unit.id, type: 'all', count: 20 }, [], () => 0);
    assert.equal(new Set(set.map(p => p.signature)).size, 20);
    set.forEach(verifyProblem);
  }
});

test('every type can produce 20 unique problems at every difficulty with reduction on or off', () => {
  for (const grade of Bank.curriculum) {
    for (const unit of grade.units) {
      for (const type of unit.types) {
        for (const difficulty of ['easy', 'normal', 'challenge']) {
          for (const requireReduction of [false, true]) {
            const set = Bank.generateSet({ grade: grade.grade, unit: unit.id, type: type.id, count: 20, difficulty, requireReduction, includeBorrow: false }, [], seeded(1046));
            assert.equal(new Set(set.map(p => p.signature)).size, 20, `${unit.id}/${type.id}/${difficulty}/${requireReduction}`);
          }
        }
      }
    }
  }
});

test('mixed division includes a mixed dividend, a mixed divisor, and both at challenge level', () => {
  const rng = seeded(603);
  const samples = Array.from({ length: 80 }, () => Bank.generateProblem({ grade: 6, unit: 'g6-divide', type: 'mixed-divide', difficulty: 'normal' }, rng));
  assert.ok(samples.some(p => p.operands[0].n > p.operands[0].d && p.operands[1].n < p.operands[1].d));
  assert.ok(samples.some(p => p.operands[0].n < p.operands[0].d && p.operands[1].n > p.operands[1].d));
  const challenge = Bank.generateProblem({ grade: 6, unit: 'g6-divide', type: 'mixed-divide', difficulty: 'challenge' }, rng);
  assert.ok(challenge.operands.every(f => f.n > f.d));
});

test('invalid unit/type is rejected clearly; invalid optional settings get safe defaults', () => {
  assert.throws(() => Bank.generateProblem({ grade: 7, unit: 'missing' }), /학년과 단원/);
  assert.throws(() => Bank.generateProblem({ grade: 5, unit: 'g5-multiply', type: 'borrow' }), /문제 유형/);
  const set = Bank.generateSet({ grade: 4, unit: 'g4-addsub', count: -9, difficulty: 'impossible' }, [], seeded(56));
  assert.equal(set.length, 10);
  set.forEach(verifyProblem);
});
