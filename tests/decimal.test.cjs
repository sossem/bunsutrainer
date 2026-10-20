const test=require('node:test'),assert=require('node:assert/strict'),D=require('../js/decimal-engine.js');
test('Exact decimal arithmetic and input boundaries',()=>{
for(const[a,b,op,want]of [['0.1','0.2','+','0.3'],['1.25','0.87','+','2.12'],['2.4','0.85','−','1.55'],['3','1.27','−','1.73'],['0.3','0.4','×','0.12'],['1.25','4','×','5'],['3.5','2','÷','1.75'],['4.08','4','÷','1.02'],['3','4','÷','0.75'],['1.26','0.3','÷','4.2'],['1.2','0.15','÷','8'],['3','0.4','÷','7.5']])assert.equal(D.calc(a,b,op),want);
assert.equal(D.rounded('2','0.7',2),'2.86');assert.equal(D.rounded('2.675','1',2),'2.68');assert.equal(D.rounded('9.995','1',2),'10.00');assert.equal(D.compare('0.5','0.50'),0);assert.equal(D.compare('0.5','0.48'),1);
for(const v of ['','0.5abc','1e-1','0..5','NaN','Infinity','0.','1,2'])assert.throws(()=>D.parse(v));assert.equal(D.parse('０．５').n,5n);assert.equal(D.parse('.5').n,5n);assert.throws(()=>D.calc('1','3','÷'));assert.throws(()=>D.calc('1','0','÷'));
});
function correctInput(p){const a=p.answer;return p.answerKind==='fraction'||p.answerKind==='ratio'?{first:a.n,second:a.d}:p.answerKind==='remainder'?{first:a.quotient,second:a.remainder}:{value:a};}
for(const t of D.types)test(t.id+' deterministic generation, answers and independent constraints',()=>{
for(const difficulty of ['easy','normal','challenge'])for(let seed=1;seed<=80;seed++){
const p=D.generate(t.id,seed,difficulty);assert.deepEqual(p,D.generate(t.id,seed,difficulty));assert.equal(p.hints.length,3);assert.ok(p.steps.length);assert.ok(D.gradeAnswer(p,correctInput(p)).correct,JSON.stringify(p));assert.doesNotThrow(()=>JSON.stringify(p));
if(/^D4-[AS]/.test(t.id)){const [a,b]=p.operands.map(x=>x.text),sub=t.id.includes('-S'),exchange=Number(t.id.at(-1))%2===0;assert.equal(D.changes(a,b,sub)>0,exchange);assert.ok(!sub||D.compare(a,b)>=0);if(t.id.endsWith('2'))assert.ok(sub?D.parse(a).n%10n<D.parse(b).n%10n:D.parse(a).n%10n+D.parse(b).n%10n>=10n);}
if(p.operands.length===2&&p.expression.includes('÷')&&p.answerKind==='number'&&!p.roundingMode){const [a,b]=p.operands.map(x=>x.text);assert.equal(D.compare(D.calc(p.answer,b,'×'),a),0);}
if(p.answerKind==='remainder'){const [a,b]=p.operands.map(x=>x.text);assert.equal(D.compare(D.calc(D.calc(b,p.answer.quotient,'×'),p.answer.remainder,'+'),a),0);assert.equal(D.compare(p.answer.remainder,b),-1);}
if(t.id==='D5-M5')for(const o of p.operands)assert.equal(D.compare(p.answer,o.text),-1);
if(p.model?.kind==='strip'&&t.id==='D3-01')assert.equal(p.answer,'0.'+p.model.k);
if(t.id==='D6A-05')assert.match(p.answer.replace('.',''),/[1-9]0+[1-9]/);
if(t.id==='D6A-04')assert.ok(D.parse(p.answer).scale>D.parse(p.operands[0].text).scale);
}});
test('49 types, grade boundaries and explicit average prerequisite',()=>{assert.equal(D.types.length,49);assert.equal(new Set(D.types.map(t=>t.id)).size,49);for(const grade of [3,4,5,6])for(const unit of D.curriculum.find(g=>g.grade===grade).units){const ps=D.generateSet({grade,unit:unit.id,type:'all',count:20,difficulty:'normal'});assert.ok(ps.every(p=>p.grade===grade));}assert.throws(()=>D.generateSet({grade:5,unit:'decimal-connection5',type:'DX-02',count:5,difficulty:'challenge'}));});
