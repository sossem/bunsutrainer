(function (global) {
  'use strict';

  // Each type has its own mathematical constraints. UI code only chooses a type.
  const curriculum = [
    { grade: 4, units: [
      { id: 'g4-addsub', title: '분수의 덧셈과 뺄셈', description: '같은 분모끼리 더하고 빼요.', types: [
        { id: 'proper-add', label: '진분수의 덧셈', description: '합이 1 이하인 덧셈' },
        { id: 'improper-add', label: '합이 1보다 큰 덧셈' },
        { id: 'proper-sub', label: '진분수의 뺄셈' },
        { id: 'one-minus', label: '1에서 분수 빼기' },
        { id: 'mixed-add', label: '대분수의 덧셈', mixed: true },
        { id: 'mixed-sub', label: '대분수의 뺄셈', mixed: true },
        { id: 'whole-minus-mixed', label: '자연수 − 대분수', mixed: true, borrow: true }
      ] }
    ] },
    { grade: 5, units: [
      { id: 'g5-equivalence', title: '약분과 통분', description: '같은 크기를 찾고, 분모를 맞춰요.', types: [
        { id: 'equivalent', label: '크기가 같은 분수' },
        { id: 'simplify', label: '약분' },
        { id: 'irreducible', label: '기약분수' },
        { id: 'common-denominator', label: '공통분모 찾기', description: '가장 작은 공통분모' },
        { id: 'common', label: '통분' },
        { id: 'compare', label: '분수의 크기 비교' }
      ] },
      { id: 'g5-addsub', title: '분수의 덧셈과 뺄셈', description: '다른 분모를 통분해 계산해요.', types: [
        { id: 'proper-add', label: '진분수 + 진분수' },
        { id: 'proper-sub', label: '진분수 − 진분수' },
        { id: 'mixed-proper-add', label: '대분수 + 진분수', mixed: true },
        { id: 'mixed-proper-sub', label: '대분수 − 진분수', mixed: true },
        { id: 'mixed-add', label: '대분수 + 대분수', mixed: true },
        { id: 'mixed-sub', label: '대분수 − 대분수', mixed: true },
        { id: 'borrow', label: '받아내림이 있는 뺄셈', mixed: true, borrow: true }
      ] },
      { id: 'g5-multiply', title: '분수의 곱셈', description: '분수만큼의 양을 구해요.', types: [
        { id: 'natural-fraction', label: '자연수 × 분수' },
        { id: 'fraction-natural', label: '분수 × 자연수' },
        { id: 'proper-multiply', label: '진분수 × 진분수' },
        { id: 'mixed-multiply', label: '대분수가 있는 곱셈', mixed: true },
        { id: 'cancellation', label: '계산 과정에서 약분' }
      ] }
    ] },
    { grade: 6, units: [
      { id: 'g6-divide', title: '분수의 나눗셈', description: '몇 묶음인지 생각하며 나눠요.', types: [
        { id: 'fraction-natural', label: '분수 ÷ 자연수' },
        { id: 'natural-fraction', label: '자연수 ÷ 분수' },
        { id: 'fraction-fraction', label: '분수 ÷ 분수' },
        { id: 'mixed-divide', label: '대분수가 있는 나눗셈', mixed: true }
      ] }
    ] }
  ];

  let nextId = 0;
  const F = () => {
    if (!global.FractionMath) throw new Error('분수 계산 엔진을 먼저 불러와 주세요.');
    return global.FractionMath;
  };
  const fraction = (n, d = 1) => ({ n, d });
  const integer = (rng, min, max) => min + Math.min(max - min, Math.floor(Math.max(0, rng()) * (max - min + 1)));
  const pick = (rng, values) => values[integer(rng, 0, values.length - 1)];
  const proper = (rng, d) => fraction(integer(rng, 1, d - 1), d);
  const isMixed = value => value.d > 1 && value.n > value.d && value.n % value.d !== 0;
  const textFraction = value => value.d === 1 ? String(value.n) : `${value.n}/${value.d}`;
  const mixedToken = value => value.n >= value.d
    ? { whole: Math.floor(value.n / value.d), n: value.n % value.d, d: value.d }
    : fraction(value.n, value.d);
  const getUnit = (grade, unitId) => curriculum.find(item => item.grade === Number(grade))?.units.find(unit => unit.id === unitId);

  function seedRng(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash(text) {
    let result = 2166136261;
    for (const character of text) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
    return result >>> 0;
  }

  function normalize(settings) {
    const grade = Number(settings.grade || 4);
    const unit = getUnit(grade, settings.unit || curriculum.find(item => item.grade === grade)?.units[0].id);
    if (!unit) throw new RangeError('학년과 단원을 확인해 주세요.');
    const type = settings.type || 'all';
    const operationGroup = unit.id.endsWith('addsub') && ['addition', 'subtraction'].includes(type);
    if (type !== 'all' && !operationGroup && !unit.types.some(item => item.id === type)) throw new RangeError('단원에 맞는 문제 유형을 선택해 주세요.');
    return {
      grade, unit: unit.id, type,
      difficulty: ['easy', 'normal', 'challenge'].includes(settings.difficulty) ? settings.difficulty : 'normal',
      count: [5, 10, 20].includes(Number(settings.count)) ? Number(settings.count) : 10,
      includeMixed: settings.includeMixed !== false,
      requireReduction: settings.requireReduction === true,
      includeBorrow: settings.includeBorrow !== false
    };
  }

  function availableTypes(settings) {
    const types = getUnit(settings.grade, settings.unit).types;
    const operationGroup = ['addition', 'subtraction'].includes(settings.type);
    if (settings.type !== 'all' && !operationGroup) return types.filter(type => type.id === settings.type);
    return types.filter(type => (settings.includeMixed || !type.mixed) && (settings.includeBorrow || !type.borrow)
      && (!operationGroup || type.id.endsWith('add') === (settings.type === 'addition')));
  }

  function denominators(settings, rng) {
    // Complexity changes with the relationship between denominators, not just size.
    const pools = {
      easy: [[2, 4], [2, 6], [3, 6], [4, 8], [3, 9], [5, 10], [2, 8], [2, 10], [3, 12], [4, 12], [6, 12]],
      normal: [[3, 4], [4, 6], [6, 8], [3, 8], [4, 10], [6, 9], [8, 12], [5, 10], [6, 12], [9, 12]],
      challenge: [[4, 6], [6, 8], [8, 12], [9, 12], [3, 10], [4, 9], [5, 6], [5, 8], [6, 10]]
    };
    let choices = pools[settings.difficulty];
    if (settings.requireReduction) choices = choices.filter(([a, b]) => F().gcd(a, b) > 1);
    const pair = pick(rng, choices).slice();
    return rng() < 0.5 ? pair : pair.reverse();
  }

  function sameDenominator(settings, rng) {
    if (settings.requireReduction) return pick(rng, [4, 6, 8, 9, 10, 12]);
    return pick(rng, settings.difficulty === 'easy' ? [3, 4, 5, 6, 8] : [4, 5, 6, 7, 8, 9, 10, 12]);
  }

  function addSubtract(settings, type, rng) {
    const same = settings.grade === 4;
    const [da, db] = same ? (() => { const d = sameDenominator(settings, rng); return [d, d]; })() : denominators(settings, rng);
    let a = proper(rng, da);
    let b = proper(rng, db);
    const wholeMinusMixed = type === 'whole-minus-mixed';
    const subtract = type.includes('sub') || type === 'one-minus' || type === 'borrow' || wholeMinusMixed;
    const operator = subtract ? '-' : '+';
    if (type === 'one-minus') a = fraction(1);
    if (type.includes('mixed') || type === 'borrow') {
      const maxWhole = settings.difficulty === 'easy' ? 2 : settings.difficulty === 'normal' ? 3 : 4;
      const bothMixed = type === 'mixed-add' || type === 'mixed-sub' || wholeMinusMixed || (type === 'borrow' && rng() < 0.65);
      const wholeB = bothMixed ? integer(rng, 1, maxWhole - (subtract ? 1 : 0)) : 0;
      const wholeA = subtract ? wholeB + integer(rng, 1, Math.max(1, maxWhole - wholeB)) : integer(rng, 1, maxWhole);
      if (wholeMinusMixed) a = fraction(wholeA);
      else a.n += wholeA * a.d;
      b.n += wholeB * b.d;
    }
    if (type === 'proper-sub' && F().compareFractions(a, b) < 0) [a, b] = [b, a];
    const common = F().lcm(a.d, b.d);
    const raw = fraction(a.n * (common / a.d) + (subtract ? -1 : 1) * b.n * (common / b.d), common);
    if (raw.n <= 0) return null;
    if (type === 'proper-add' && same && raw.n > raw.d) return null;
    if (type === 'improper-add' && raw.n <= raw.d) return null;
    const borrowing = subtract && Math.floor(a.n / a.d) > 0 && (a.n % a.d) * (common / a.d) < (b.n % b.d) * (common / b.d);
    if (type === 'borrow' && !borrowing) return null;
    if (type !== 'one-minus' && type !== 'borrow' && !wholeMinusMixed && !settings.includeBorrow && borrowing) return null;
    // An easy mixed addition avoids carrying; a challenge includes carrying when adding two mixed numbers.
    if (type === 'mixed-add') {
      const fractionalSum = (a.n % a.d) * (common / a.d) + (b.n % b.d) * (common / b.d);
      if (settings.difficulty === 'easy' && fractionalSum >= common) return null;
      if (settings.difficulty === 'challenge' && fractionalSum <= common) return null;
    }
    return { operands: [a, b], operator, raw, borrowing };
  }

  function multiplication(settings, type, rng) {
    const ds = settings.difficulty === 'easy' ? [2, 3, 4, 5, 6] : [3, 4, 5, 6, 8, 10];
    let a = proper(rng, pick(rng, ds));
    let b = proper(rng, pick(rng, ds));
    const natural = () => fraction(integer(rng, 2, settings.difficulty === 'easy' ? 4 : 6));
    if (type === 'natural-fraction') a = natural();
    if (type === 'fraction-natural') b = natural();
    if (type === 'mixed-multiply') {
      a.n += integer(rng, 1, settings.difficulty === 'challenge' ? 3 : 2) * a.d;
      if (settings.difficulty === 'challenge') b.n += integer(rng, 1, 2) * b.d;
    }
    const cross1 = F().gcd(a.n, b.d);
    const cross2 = F().gcd(b.n, a.d);
    if (type === 'cancellation' && cross1 === 1 && cross2 === 1) return null;
    if (type === 'cancellation' && settings.difficulty === 'challenge' && (cross1 === 1 || cross2 === 1)) return null;
    return { operands: [a, b], operator: '×', raw: fraction(a.n * b.n, a.d * b.d) };
  }

  function division(settings, type, rng) {
    const ds = settings.difficulty === 'easy' ? [2, 3, 4, 5, 6] : [3, 4, 5, 6, 8, 10, 12];
    let a = proper(rng, pick(rng, ds));
    let b = proper(rng, pick(rng, ds));
    if (type === 'fraction-natural') b = fraction(integer(rng, 2, settings.difficulty === 'easy' ? 4 : 6));
    if (type === 'natural-fraction') a = fraction(integer(rng, 2, settings.difficulty === 'challenge' ? 6 : 4));
    if (type === 'fraction-fraction' && settings.difficulty === 'easy') b.d = a.d;
    if (type === 'mixed-divide') {
      const placement = settings.difficulty === 'challenge' ? 'both' : rng() < 0.5 ? 'left' : 'right';
      if (placement !== 'right') a.n += integer(rng, 1, settings.difficulty === 'challenge' ? 3 : 2) * a.d;
      if (placement !== 'left') b.n += integer(rng, 1, 2) * b.d;
    }
    // Reset the numerator if the easy same-denominator choice changed b's denominator.
    if (type === 'fraction-fraction' && b.n >= b.d) return null;
    return { operands: [a, b], operator: '÷', raw: fraction(a.n * b.d, a.d * b.n) };
  }

  function reductionSteps(raw, answer, grade) {
    const steps = [];
    const gcd = F().gcd(raw.n, raw.d);
    if (grade !== 4 && gcd > 1) {
      steps.push({ title: '약분하기', text: `분자와 분모를 최대공약수 ${gcd}로 나누어요.`, tokens: [raw, '=', answer] });
    }
    if (answer.n > answer.d && answer.n % answer.d !== 0) {
      steps.push({ title: '대분수로 정리하기', text: '분자를 분모로 나눈 몫은 자연수, 나머지는 분자가 돼요.', tokens: [answer, '=', mixedToken(answer)] });
    } else if (answer.n % answer.d === 0 && answer.d !== 1) {
      steps.push({ title: '자연수로 정리하기', text: '분자가 분모의 배수이면 자연수로 나타낼 수 있어요.', tokens: [answer, '=', String(answer.n / answer.d)] });
    }
    return steps;
  }

  function addSubtractSteps(data, settings) {
    const [a, b] = data.operands;
    const common = data.raw.d;
    const ac = fraction(a.n * (common / a.d), common);
    const bc = fraction(b.n * (common / b.d), common);
    const steps = [];
    const mixed = isMixed(a) || isMixed(b);
    const token = mixed ? mixedToken : value => value;
    if (a.d !== b.d && settings.grade !== 4) {
      if (a.d !== common) steps.push({ title: '첫 번째 분수 통분하기', text: `가장 작은 공통분모는 ${common}예요. 분자와 분모에 ${common / a.d}을 곱해요.`, tokens: [token(a), '=', token(ac)] });
      if (b.d !== common) steps.push({ title: '두 번째 분수 통분하기', text: `분자와 분모에 ${common / b.d}을 곱해 분모를 ${common}로 맞춰요.`, tokens: [token(b), '=', token(bc)] });
    }
    if (data.operator === '-' && a.d === 1) {
      steps.push({ title: '1을 분수로 나타내기', text: `1은 ${common}분의 ${common}과 같아요.`, tokens: ['1', '=', fraction(common, common)] });
    }
    if (mixed) {
      const wa = Math.floor(ac.n / common);
      const wb = Math.floor(bc.n / common);
      const na = ac.n % common;
      const nb = bc.n % common;
      const workingA = { whole: wa - (data.borrowing ? 1 : 0), n: na + (data.borrowing ? common : 0), d: common };
      const workingB = { whole: wb, n: nb, d: common };
      if (data.borrowing) {
        steps.push({ title: '자연수에서 1 받아내리기', text: `분자 ${na}에서 ${nb}을 뺄 수 없으니, 자연수 1을 ${common}분의 ${common}으로 바꿔요.`, tokens: [mixedToken(ac), '=', workingA] });
      }
      const result = {
        whole: workingA.whole + (data.operator === '+' ? wb : -wb),
        n: workingA.n + (data.operator === '+' ? nb : -nb), d: common
      };
      steps.push({ title: data.operator === '+' ? '자연수끼리, 분수끼리 더하기' : '자연수끼리, 분수끼리 빼기', text: '분모는 그대로 두고 분자를 계산해요.', tokens: [workingA, data.operator, workingB, '=', result] });
      if (result.n >= common) steps.push({ title: '분수 부분에서 1 만들기', text: `분수 부분이 1 이상이면 ${common}분의 ${common}을 자연수 1로 옮겨요.`, tokens: [result, '=', mixedToken(data.raw)] });
    } else {
      steps.push({ title: data.operator === '+' ? '분자끼리 더하기' : '분자끼리 빼기', text: `분모 ${common}는 그대로 두고 분자만 계산해요.`, tokens: [ac, data.operator, bc, '=', data.raw] });
    }
    const reduction = reductionSteps(data.raw, data.answer, settings.grade);
    // Mixed inputs have already been presented as mixed values. Show the final result once.
    if (mixed && settings.grade !== 4 && data.raw.n % data.raw.d !== 0 && F().gcd(data.raw.n, data.raw.d) > 1) {
      steps.push({ title: '분수 부분 약분하기', text: `분자와 분모의 공약수 ${F().gcd(data.raw.n, data.raw.d)}로 약분해 정리해요.`, tokens: [mixedToken(data.raw), '=', mixedToken(data.answer)] });
    } else if (!mixed) steps.push(...reduction);
    return steps;
  }

  function productSteps(data, settings) {
    const [a, b] = data.operands;
    const steps = [];
    for (const [index, operand] of data.operands.entries()) {
      if (isMixed(operand)) steps.push({ title: `${index + 1}번째 대분수를 가분수로`, text: '자연수 × 분모 + 분수 부분의 분자로 새 분자를 구해요.', tokens: [mixedToken(operand), '=', operand] });
    }
    let right = b;
    if (data.operator === '÷') {
      right = fraction(b.d, b.n);
      if (b.d === 1) {
        steps.push({ title: '똑같이 나누는 뜻 생각하기', text: `${textFraction(a)}를 ${b.n}묶음으로 똑같이 나누면 한 묶음은 전체의 ${b.n}분의 1이에요.`, tokens: [a, '×', right] });
      } else {
        steps.push({ title: '나누는 수를 1로 만들기', text: '나누는 수와 나누어지는 수에 같은 수를 곱해도 몫은 같아요. 나누는 수에 역수를 곱하면 1이 돼요.', tokens: [b, '×', right, '=', '1'] });
        steps.push({ title: '역수를 곱하는 이유', text: '나누어지는 수도 똑같이 역수배 해요. 이제 1로 나누므로, 이 곱이 곧 몫이에요.', tokens: [a, '×', right] });
      }
    } else if (a.d === 1 || b.d === 1) {
      const natural = a.d === 1 ? a : b;
      steps.push({ title: '자연수를 분수로 나타내기', text: '자연수는 분모가 1인 분수로 나타낼 수 있어요.', tokens: [String(natural.n), '=', { n: natural.n, d: 1, forceFraction: true }] });
    }
    const g1 = F().gcd(a.n, right.d);
    const g2 = F().gcd(right.n, a.d);
    let leftWork = a;
    let rightWork = right;
    if (g1 > 1 || g2 > 1) {
      leftWork = fraction(a.n / g1, a.d / g2);
      rightWork = fraction(right.n / g2, right.d / g1);
      const explanation = [];
      if (g1 > 1) explanation.push(`첫 분자 ${a.n}와 둘째 분모 ${right.d}를 ${g1}로`);
      if (g2 > 1) explanation.push(`둘째 분자 ${right.n}와 첫 분모 ${a.d}를 ${g2}로`);
      steps.push({ title: '곱하기 전에 약분하기', text: `${explanation.join(', ')} 나누어요. 분자와 분모에서 같은 인수를 없애는 거예요.`, tokens: [leftWork, '×', rightWork] });
    }
    const workingRaw = fraction(leftWork.n * rightWork.n, leftWork.d * rightWork.d);
    steps.push({ title: '분자끼리, 분모끼리 곱하기', text: `분자는 ${leftWork.n} × ${rightWork.n}, 분모는 ${leftWork.d} × ${rightWork.d}로 계산해요.`, tokens: [leftWork, '×', rightWork, '=', workingRaw] });
    steps.push(...reductionSteps(workingRaw, data.answer, settings.grade));
    if (data.operator === '÷') steps.push({ title: '곱셈으로 확인하기', text: '몫에 나누는 수를 곱하면 처음 양이 되는지 확인해요.', tokens: [data.answer, '×', b, '=', a] });
    return steps;
  }

  function arithmetic(settings, type, rng) {
    const data = settings.unit.endsWith('addsub') ? addSubtract(settings, type, rng)
      : settings.unit === 'g5-multiply' ? multiplication(settings, type, rng) : division(settings, type, rng);
    if (!data || data.raw.n <= 0 || data.raw.d <= 0 || data.raw.n / data.raw.d > 24) return null;
    if (settings.requireReduction && F().gcd(data.raw.n, data.raw.d) === 1) return null;
    data.kind = 'calculation';
    data.answer = settings.grade === 4 ? data.raw : F().simplifyFraction(data.raw);
    // Keep even challenge results readable and useful for mental/scratch-paper work.
    const maxResultDenominator = settings.difficulty === 'easy' ? 24 : settings.difficulty === 'normal' ? 48 : 60;
    if (data.answer.d > maxResultDenominator || data.answer.n > 240) return null;
    data.requireReduced = settings.grade !== 4;
    data.prompt = settings.grade === 4 ? '계산해 보세요.' : '계산하고 분수 부분은 기약분수로 나타내 보세요.';
    if (data.operator === '+' || data.operator === '-') {
      data.hint = data.borrowing ? '분수 부분을 뺄 수 없다면 자연수 1을 받아내려 보세요.'
        : data.operands[0].d !== data.operands[1].d && settings.grade !== 4 ? '먼저 두 분모의 공배수를 찾아 분모를 같게 해 보세요.'
          : type === 'one-minus' ? '1을 빼는 분수와 분모가 같은 분수로 바꾸어 보세요.' : '분모는 그대로 두고 분자끼리 계산해 보세요.';
      data.steps = addSubtractSteps(data, settings);
      data.visual = { kind: 'bars', fractions: data.operands };
    } else {
      data.hint = data.operator === '×' ? '대분수는 가분수로 바꾸고, 곱하기 전에 약분할 수 있는지 살펴보세요.'
        : '나누는 수가 몇 묶음 들어가는지 생각해 보세요. 나누는 수와 나누어지는 수를 같은 비율로 바꾸어도 몫은 같아요.';
      data.steps = productSteps(data, settings);
      if (data.operator === '÷') data.visual = { kind: 'division', a: data.operands[0], b: data.operands[1] };
      else if (data.operands.every(value => value.n < value.d)) data.visual = { kind: 'area', a: data.operands[0], b: data.operands[1] };
      else data.visual = { kind: 'bars', fractions: data.operands };
    }
    return data;
  }

  function concepts(settings, type, rng) {
    if (type === 'equivalent') {
      const d = pick(rng, settings.difficulty === 'easy' ? [2, 3, 4, 5, 6] : [3, 4, 5, 6, 8]);
      const a = proper(rng, d);
      const factor = pick(rng, settings.difficulty === 'easy' ? [2, 3] : settings.difficulty === 'normal' ? [2, 3, 4] : [3, 4, 5, 6]);
      const equivalent = fraction(a.n * factor, a.d * factor);
      return {
        kind: 'equivalent', operands: [a], operator: '=', answer: equivalent.n, targetDen: equivalent.d,
        prompt: '크기가 같은 분수가 되도록 빈칸을 채워 보세요.',
        hint: `분모 ${a.d}가 ${equivalent.d}가 되려면 몇 배 해야 할까요? 분자에도 같은 수를 곱해요.`,
        steps: [
          { title: '분모가 몇 배인지 알아보기', text: `${equivalent.d} ÷ ${a.d} = ${factor}이므로 분모가 ${factor}배 되었어요.`, tokens: [String(a.d), '×', String(factor), '=', String(equivalent.d)] },
          { title: '분자도 같은 배로 만들기', text: `분자와 분모에 같은 수 ${factor}을 곱하면 분수의 크기는 같아요.`, tokens: [a, '=', equivalent] }
        ], visual: { kind: 'equivalence', fractions: [a, equivalent] }
      };
    }
    if (type === 'simplify' || type === 'irreducible') {
      const d = pick(rng, settings.difficulty === 'easy' ? [2, 3, 4, 5, 6] : [3, 4, 5, 6, 8, 9, 10]);
      const base = F().simplifyFraction(proper(rng, d));
      const factor = pick(rng, settings.difficulty === 'easy' ? [2, 3] : settings.difficulty === 'normal' ? [2, 3, 4] : [4, 6]);
      const a = fraction(base.n * factor, base.d * factor);
      return {
        kind: 'simplify', operands: [a], answer: base, requireReduced: true,
        prompt: type === 'irreducible' ? '기약분수로 나타내 보세요.' : '약분하여 가장 간단한 분수로 나타내 보세요.',
        hint: '분자와 분모를 둘 다 나눌 수 있는 수를 찾아보세요.',
        steps: [
          { title: '최대공약수 찾기', text: `${a.n}와 ${a.d}를 모두 나눌 수 있는 가장 큰 수는 ${factor}예요.`, tokens: [String(a.n), '÷', String(factor), '=', String(base.n)] },
          { title: '분자와 분모를 같은 수로 나누기', text: `분자와 분모를 ${factor}로 나누면 크기는 그대로이고 수는 간단해져요.`, tokens: [a, '=', base] },
          { title: '기약분수 확인하기', text: `${base.n}와 ${base.d}의 공약수는 1뿐이에요. 더 이상 약분할 수 없어요.`, tokens: [base] }
        ], visual: { kind: 'equivalence', fractions: [a, base] }
      };
    }
    let [da, db] = denominators(settings, rng);
    let a = proper(rng, da);
    let b = proper(rng, db);
    if (type === 'compare' && rng() < 0.25) {
      [da, db] = pick(rng, [[2, 4], [3, 6], [4, 8], [3, 9], [2, 6], [5, 10]]);
      a = proper(rng, da);
      b = fraction(a.n * (db / da), db);
    }
    const common = F().lcm(a.d, b.d);
    const ac = fraction(a.n * (common / a.d), common);
    const bc = fraction(b.n * (common / b.d), common);
    const commonSteps = [
      { title: '가장 작은 공통분모 찾기', text: `${a.d}와 ${b.d}의 최소공배수 ${common}를 공통분모로 정해요.`, tokens: [String(common)] },
      { title: '첫 번째 분수 통분하기', text: `분자와 분모에 ${common / a.d}을 곱해요.`, tokens: [a, '=', ac] },
      { title: '두 번째 분수 통분하기', text: `분자와 분모에 ${common / b.d}을 곱해요.`, tokens: [b, '=', bc] }
    ];
    if (type === 'common-denominator') {
      const multiplesA = Array.from({ length: common / a.d }, (_, index) => (index + 1) * a.d);
      const multiplesB = Array.from({ length: common / b.d }, (_, index) => (index + 1) * b.d);
      return {
        kind: 'common-denominator', operands: [a, b], answer: common, targetDen: common,
        prompt: '두 분수의 가장 작은 공통분모를 찾아보세요.',
        hint: '두 분모의 배수를 차례로 떠올려 보세요. 처음으로 만나는 같은 수를 찾아요.',
        steps: [
          { title: '첫 번째 분모의 배수', text: `${a.d}의 배수를 차례로 써 보아요.`, tokens: [multiplesA.join(', ')] },
          { title: '두 번째 분모의 배수', text: `${b.d}의 배수에서 처음으로 겹치는 수를 찾아요.`, tokens: [multiplesB.join(', ')] },
          commonSteps[0]
        ], visual: { kind: 'equivalence', fractions: [a, ac] }
      };
    }
    if (type === 'common') return {
      kind: 'common', operands: [a, b], answer: [ac, bc], targetDen: common,
      prompt: '가장 작은 공통분모로 통분해 보세요.',
      hint: '두 분모의 최소공배수를 구한 뒤, 각 분자와 분모에 같은 수를 곱해요.',
      steps: commonSteps, visual: { kind: 'equivalence', fractions: [a, ac] }
    };
    const symbol = ['<', '=', '>'][F().compareFractions(a, b) + 1];
    return {
      kind: 'compare', operands: [a, b], answer: symbol,
      prompt: '알맞은 기호 >, =, <를 골라 보세요.',
      hint: '분모를 같게 만들면 분자가 큰 분수의 크기가 더 커요.',
      steps: [...commonSteps, { title: '분자 크기로 비교하기', text: ac.n === bc.n ? '분모와 분자가 각각 같으므로 크기가 같아요.' : `같은 크기의 조각이 ${ac.n}개와 ${bc.n}개예요. 조각이 더 많은 쪽이 커요.`, tokens: [ac, symbol, bc] }],
      visual: { kind: 'number-line', fractions: [a, b] }
    };
  }

  function generateProblem(rawSettings, rng = Math.random) {
    const settings = normalize(rawSettings);
    const options = availableTypes(settings);
    const selected = pick(rng, options);
    const fallback = seedRng(hash(`${settings.unit}|${selected.id}|${settings.difficulty}|${settings.requireReduction}`));
    for (let attempt = 0; attempt < 256; attempt++) {
      const random = attempt < 96 ? rng : fallback;
      const data = settings.unit === 'g5-equivalence' ? concepts(settings, selected.id, random) : arithmetic(settings, selected.id, random);
      if (!data) continue;
      const signature = JSON.stringify([settings.unit, selected.id, data.operands, data.targetDen || null]);
      return {
        id: `problem-${++nextId}`, signature, grade: settings.grade, unit: settings.unit,
        type: selected.id, typeLabel: selected.label, requireReduced: false, ...data
      };
    }
    throw new RangeError('선택한 조건에 맞는 문제를 만들지 못했어요. 다른 유형이나 난이도를 선택해 주세요.');
  }

  function generateSet(rawSettings, previous = [], rng = Math.random) {
    const settings = normalize(rawSettings);
    const types = availableTypes(settings).slice();
    // Shuffle the cycle, then distribute types evenly throughout the set.
    for (let i = types.length - 1; i > 0; i--) {
      const index = integer(rng, 0, i);
      [types[i], types[index]] = [types[index], types[i]];
    }
    const earlier = new Set(previous.map(item => typeof item === 'string' ? item : item.signature));
    const current = new Set();
    const result = [];
    for (let index = 0; index < settings.count; index++) {
      const type = types[index % types.length].id;
      let chosen = null;
      let reusable = null;
      const fallback = seedRng(hash(`${JSON.stringify(settings)}|${index}|${previous.length}`));
      for (let attempt = 0; attempt < 320; attempt++) {
        const candidate = generateProblem({ ...settings, type }, attempt < 32 ? rng : fallback);
        if (current.has(candidate.signature)) continue;
        reusable = candidate;
        if (!earlier.has(candidate.signature)) { chosen = candidate; break; }
        // A finite type can exhaust older history; never repeat within the new set.
        if (attempt >= 160) { chosen = candidate; break; }
      }
      chosen = chosen || reusable;
      if (!chosen) throw new RangeError('이 조건에서 서로 다른 문제를 충분히 만들지 못했어요. 문제 수를 줄이거나 여러 유형을 섞어 주세요.');
      current.add(chosen.signature);
      result.push(chosen);
    }
    return result;
  }

  global.ProblemBank = Object.freeze({ curriculum, getUnit, generateProblem, generateSet });
  if (typeof module !== 'undefined' && module.exports) module.exports = global.ProblemBank;
})(globalThis);
