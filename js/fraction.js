/* Exact fraction arithmetic and answer checking, independent of the DOM. */
(function (root) {
  'use strict';

  const MAX_INPUT = 10000;
  function integer(value, name = '수') {
    if (!Number.isSafeInteger(value)) throw new TypeError(`${name}는 안전한 정수여야 합니다.`);
    return value;
  }
  function checkedNumber(value) {
    const result = Number(value);
    if (!Number.isSafeInteger(result)) throw new RangeError('계산 결과가 안전한 정수 범위를 벗어났습니다.');
    return result;
  }
  function bigGcd(a, b) {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b) [a, b] = [b, a % b];
    return a;
  }
  function gcd(a, b) {
    return checkedNumber(bigGcd(BigInt(integer(a)), BigInt(integer(b))));
  }
  function lcm(a, b) {
    integer(a); integer(b);
    if (!a || !b) return 0;
    const result = BigInt(a) / bigGcd(BigInt(a), BigInt(b)) * BigInt(b);
    return checkedNumber(result < 0n ? -result : result);
  }
  function parts(fraction) {
    if (!fraction || typeof fraction !== 'object') throw new TypeError('분수가 필요합니다.');
    const n = BigInt(integer(fraction.n, '분자'));
    const d = BigInt(integer(fraction.d, '분모'));
    if (d === 0n) throw new RangeError('분모는 0이 될 수 없습니다.');
    return d < 0n ? [-n, -d] : [n, d];
  }
  function reduced(n, d) {
    if (d === 0n) throw new RangeError('분모는 0이 될 수 없습니다.');
    if (d < 0n) { n = -n; d = -d; }
    const factor = bigGcd(n, d);
    return { n: checkedNumber(n / factor), d: checkedNumber(d / factor) };
  }
  function simplifyFraction(fraction) { return reduced(...parts(fraction)); }
  function compareFractions(a, b) {
    const [an, ad] = parts(a), [bn, bd] = parts(b);
    const delta = an * bd - bn * ad;
    return delta < 0n ? -1 : delta > 0n ? 1 : 0;
  }
  function equivalentFractions(a, b) { return compareFractions(a, b) === 0; }
  function addFractions(a, b) {
    const [an, ad] = parts(a), [bn, bd] = parts(b);
    return reduced(an * bd + bn * ad, ad * bd);
  }
  function subtractFractions(a, b) {
    const [an, ad] = parts(a), [bn, bd] = parts(b);
    return reduced(an * bd - bn * ad, ad * bd);
  }
  function multiplyFractions(a, b) {
    const [an, ad] = parts(a), [bn, bd] = parts(b);
    return reduced(an * bn, ad * bd);
  }
  function divideFractions(a, b) {
    const [an, ad] = parts(a), [bn, bd] = parts(b);
    if (bn === 0n) throw new RangeError('0으로 나눌 수 없습니다.');
    return reduced(an * bd, ad * bn);
  }
  function improperToMixed(fraction) {
    const { n, d } = simplifyFraction(fraction);
    // Signed remainders keep the conversion exact for negative fractions, too.
    return { whole: Math.trunc(n / d) || 0, n: n % d || 0, d };
  }
  function mixedToImproper(whole, n, d) {
    integer(whole, '자연수');
    const [numerator, denominator] = parts({ n, d });
    return reduced(BigInt(whole) * denominator + numerator, denominator);
  }
  function commonDenominator(a, b) {
    const [an, ad] = parts(a), [bn, bd] = parts(b);
    const denominator = ad / bigGcd(ad, bd) * bd;
    return [
      { n: checkedNumber(an * (denominator / ad)), d: checkedNumber(denominator) },
      { n: checkedNumber(bn * (denominator / bd)), d: checkedNumber(denominator) }
    ];
  }

  function parseWholeNumber(value) {
    const text = value === undefined || value === null ? '' : String(value).trim();
    if (!/^\d+$/.test(text)) return null;
    const result = Number(text);
    return Number.isSafeInteger(result) && result <= MAX_INPUT ? result : null;
  }
  function empty(value) { return value === undefined || value === null || String(value).trim() === ''; }
  function invalid(message) { return { valid: false, value: null, raw: null, message }; }
  function parseAnswer(input) {
    if (!input || typeof input !== 'object') return invalid('답을 입력해 주세요.');
    const { whole, num, den } = input;
    if (empty(whole) && empty(num) && empty(den)) return invalid('답을 입력해 주세요.');
    if (empty(num) !== empty(den)) return invalid('분자와 분모를 모두 입력해 주세요.');
    const w = empty(whole) ? 0 : parseWholeNumber(whole);
    if (w === null) return invalid('자연수 칸에는 0부터 10000까지의 정수를 입력해 주세요.');
    if (empty(num) && empty(den)) {
      return { valid: true, value: { n: w, d: 1 }, raw: { n: w, d: 1 }, message: '' };
    }
    const n = parseWholeNumber(num), d = parseWholeNumber(den);
    if (n === null || d === null) return invalid('분자와 분모에는 0부터 10000까지의 정수를 입력해 주세요.');
    if (d === 0) return invalid('분모는 0이 될 수 없어요. 1 이상의 수를 입력해 주세요.');
    const raw = { n: w * d + n, d };
    return { valid: true, value: simplifyFraction(raw), raw, message: '' };
  }
  function result(correct, code, message, value = null, valid = true) {
    return { correct, code, message, value, valid };
  }
  function diagnostic(problem, value) {
    const [a, b] = problem.operands || [];
    const op = problem.operator;
    if (!a || !b) return null;
    if (op === '+' && equivalentFractions(value, { n: a.n + b.n, d: a.d + b.d })) {
      return result(false, 'add-denominators', '분모끼리 더하지 않아요. 같은 크기의 조각으로 통분한 뒤 분자끼리 더해 보세요.', value);
    }
    if (op === '÷' && equivalentFractions(value, multiplyFractions(a, b))) {
      return result(false, 'reciprocal', '나누는 분수의 분자와 분모를 바꾼 뒤 곱해 보세요.', value);
    }
    if (op === '÷' && a.n !== 0 && equivalentFractions(value, divideFractions(b, a))) {
      return result(false, 'reciprocal', '나누어지는 수는 그대로 두고, 나누는 수만 뒤집어 곱해 보세요.', value);
    }
    if ((op === '+' || op === '-') && a.d !== b.d) {
      const denominator = lcm(a.d, b.d);
      const n = op === '+' ? a.n + b.n : a.n - b.n;
      if (equivalentFractions(value, { n, d: denominator })) {
        return result(false, 'common-denominator', '분모를 바꾼 만큼 분자에도 같은 수를 곱해야 해요. 통분 과정을 다시 확인해 보세요.', value);
      }
    }
    const operations = { '+': addFractions, '-': subtractFractions, '×': multiplyFractions, '÷': divideFractions };
    const operation = operations[op];
    if (operation && (a.n >= a.d || b.n >= b.d)) {
      const mistaken = (f) => f.n >= f.d ? { n: Math.floor(f.n / f.d) + f.n % f.d, d: f.d } : f;
      const wrongA = mistaken(a), wrongB = mistaken(b);
      for (const pair of [[wrongA, b], [a, wrongB], [wrongA, wrongB]]) {
        if (op === '÷' && pair[1].n === 0) continue;
        const guess = operation(...pair);
        if (!equivalentFractions(guess, problem.answer) && equivalentFractions(guess, value)) {
          return result(false, 'mixed-conversion', '대분수를 가분수로 바꿀 때는 자연수 × 분모 + 분자를 새 분자로 써요.', value);
        }
      }
    }
    return null;
  }
  function gradeAnswer(problem, input) {
    if (!problem || !Object.prototype.hasOwnProperty.call(problem, 'answer')) {
      return result(false, 'invalid-problem', '문제 정보를 확인할 수 없어요. 새 문제를 선택해 주세요.', null, false);
    }
    if (problem.kind === 'compare') {
      const symbol = typeof input === 'string' ? input : input && input.symbol;
      if (!['<', '=', '>'].includes(symbol)) return result(false, 'invalid-input', '알맞은 비교 기호를 선택해 주세요.', null, false);
      return symbol === problem.answer
        ? result(true, 'correct', '정답이에요! 분수의 크기를 잘 비교했어요.', symbol)
        : result(false, 'comparison', '같은 분모로 통분한 뒤 분자의 크기를 비교해 보세요.', symbol);
    }
    if (problem.kind === 'equivalent' || problem.kind === 'common-denominator' || typeof problem.answer === 'number') {
      const value = parseWholeNumber(typeof input === 'object' && input !== null ? input.integer : input);
      if (value === null) return result(false, 'invalid-input', '빈칸에 0부터 10000까지의 정수를 입력해 주세요.', null, false);
      if (value === problem.answer) return result(true, 'correct', '정답이에요! 잘했어요.', value);
      if (problem.kind === 'common-denominator') {
        return result(false, 'common-denominator', '두 분모의 배수 중에서 가장 작은 공통된 수를 찾아보세요.', value);
      }
      return result(false, 'equivalent', '분모에 곱한 수와 같은 수를 분자에도 곱해 보세요.', value);
    }
    if (problem.kind === 'common') {
      const inputs = Array.isArray(input) ? input : input && input.fractions;
      if (!Array.isArray(inputs) || inputs.length !== 2) return result(false, 'invalid-input', '통분한 두 분수를 입력해 주세요.', null, false);
      const parsed = inputs.map(parseAnswer);
      const missing = parsed.find((item) => !item.valid);
      if (missing) return result(false, 'invalid-input', missing.message, null, false);
      const expected = problem.answer;
      const valuesMatch = Array.isArray(expected) && parsed.every((item, i) => equivalentFractions(item.value, expected[i]));
      if (!valuesMatch) return result(false, 'common-denominator', '분모와 분자에 같은 수를 곱해서 원래 분수와 크기가 같도록 만들어 보세요.', parsed.map((item) => item.value));
      const requiredDen = problem.targetDen || expected[0].d;
      if (parsed.some((item) => item.raw.d !== requiredDen)) {
        return result(false, 'target-denominator', `두 분수의 분모를 모두 ${requiredDen}(으)로 맞춰 주세요.`, parsed.map((item) => item.value));
      }
      return result(true, 'correct', '정답이에요! 같은 크기를 유지하면서 통분했어요.', parsed.map((item) => item.value));
    }
    const parsed = parseAnswer(input);
    if (!parsed.valid) return result(false, 'invalid-input', parsed.message, null, false);
    if (equivalentFractions(parsed.value, problem.answer)) {
      if ((problem.requireReduced || problem.kind === 'simplify') && gcd(parsed.raw.n, parsed.raw.d) !== 1) {
        return result(false, 'needs-reduction', '분수의 값은 맞아요! 분자와 분모를 같은 수로 나누어 기약분수로 나타내 주세요.', parsed.value);
      }
      return result(true, 'correct', '정답이에요! 잘했어요.', parsed.value);
    }
    return diagnostic(problem, parsed.value) || result(false, 'calculation', '계산을 한 번 더 확인해 볼까요? 힌트를 보고 한 단계씩 풀어 보세요.', parsed.value);
  }

  const api = Object.freeze({ gcd, lcm, simplifyFraction, compareFractions, addFractions, subtractFractions, multiplyFractions, divideFractions, improperToMixed, mixedToImproper, equivalentFractions, commonDenominator, parseAnswer, gradeAnswer });
  root.FractionMath = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
