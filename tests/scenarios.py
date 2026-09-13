"""Real pointer/keyboard, persistent history and presentation layout integration checks."""
import json
import time
from browser_test import Browser, ARTIFACTS


def run():
    report = {"checks": [], "layouts": [], "failures": []}

    def check(name, passed, detail=None):
        report["checks"].append({"name": name, "passed": bool(passed), "detail": detail})
        if not passed:
            report["failures"].append(name)

    with Browser() as b:
        # Observe generated data only in the test browser. Production has no test state API.
        b.command("Page.addScriptToEvaluateOnNewDocument", {"source": """
          (() => { let bank; Object.defineProperty(globalThis,'ProblemBank', {
            configurable:true,get(){return bank},set(value){bank={...value,generateSet(...args){
              const result=value.generateSet(...args);globalThis.__testProblems=result;return result;
            }};}
          }); })();
        """})

        def click(action, value=None):
            selector = f'[data-action="{action}"]'
            if value is not None:
                selector += f'[data-value="{value}"]'
            b.click(selector)

        def setting(name, value):
            b.eval(f"(() => {{const e=document.querySelector('[data-setting=\"{name}\"]');e.value={json.dumps(str(value))};e.dispatchEvent(new Event('change',{{bubbles:true}}));}})()")

        def configure(mode="classroom", grade=5, unit="g5-addsub", kind="all", difficulty="normal", count=10):
            if b.eval("!!document.fullscreenElement"):
                b.eval("document.exitFullscreen()")
            b.navigate()
            click("mode", mode)
            click("grade", grade)
            click("unit", unit)
            setting("type", kind)
            click("difficulty", difficulty)
            setting("count", count)
            click("start")
            b.wait(".problem-equation")

        def layout(name):
            result = b.eval("""(() => {
              const s=document.querySelector('.classroom-stage'),stage=s.getBoundingClientRect();
              const nodes=[...s.querySelectorAll('.problem-prompt,.math-line,.fraction,.step-heading,.step-text,.visual-caption,.fraction-bar,.visual-tabs,.circle-models,.area-model')];
              const overflow=nodes.map(el=>({el,r:el.getBoundingClientRect()})).filter(({r})=>r.width&&r.height&&(r.left<stage.left-2||r.right>stage.right+2||r.top<stage.top-2||r.bottom>stage.bottom+2)).map(({el,r})=>({class:el.className,text:el.textContent.slice(0,100),x:r.x,y:r.y,w:r.width,h:r.height}));
              const controls=[...document.querySelectorAll('.teacher-controls button,.classroom-toolbar button')];
              const outside=controls.some(el=>{const r=el.getBoundingClientRect();return r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1;});
              return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,scrollY,overflow,outside,
                problemFont:parseFloat(getComputedStyle(s.querySelector('.problem-equation')).fontSize),solutionFont:s.querySelector('.step-equation')?parseFloat(getComputedStyle(s.querySelector('.step-equation')).fontSize):null,
                controlHeight:controls[0].getBoundingClientRect().height};
            })()""")
            report["layouts"].append({"name": name, **result})
            okay = not result["overflow"] and not result["outside"] and result["scrollWidth"] <= result["width"] and result["scrollHeight"] <= result["height"] and result["scrollY"] == 0
            check(name, okay, result if not okay else None)
            if not okay:
                b.screenshot(f'overflow-{len(report["layouts"])}.png')
            return result

        def fill(name, value):
            b.eval(f"(() => {{const e=document.querySelector('[name=\"{name}\"]');e.value={json.dumps(str(value))};e.dispatchEvent(new Event('input',{{bubbles:true}}));}})()")

        def answer_problem(index=0, multiply=1):
            p = b.eval(f"__testProblems[{index}]")
            a = p["answer"]
            if p["kind"] == "compare":
                click("symbol", a)
            elif p["kind"] in ["equivalent", "common-denominator"]:
                fill("integer", a)
            elif p["kind"] == "common":
                for prefix, f in zip(["a-", "b-"], a):
                    fill(prefix + "num", f["n"])
                    fill(prefix + "den", f["d"])
            else:
                fill("num", a["n"] * multiply)
                fill("den", a["d"] * multiply)
            b.click('[type="submit"]')

        b.navigate()
        b.eval("localStorage.removeItem('bunsu.learning.v1')")
        b.navigate()
        b.screenshot("home-fhd.png")
        check("home separates two modes", b.eval("document.querySelectorAll('.mode-card').length === 2"))
        configure()
        check("5th grade basic ten questions", b.eval("__testProblems.length===10 && document.querySelector('.classroom-context').textContent.includes('5학년')"))
        check("initial answer and solutions hidden", b.eval("!document.querySelector('.reveal-panel') && document.querySelector('[data-action=solution]').disabled"))
        initial = layout("FHD problem only")
        check("FHD presentation typography and touch buttons", initial["problemFont"] >= 120 and initial["controlHeight"] >= 70)
        b.screenshot("classroom-problem-fhd.png")
        click("hint"); layout("FHD hint"); check("hint only", b.eval("!!document.querySelector('.hint-panel') && !document.querySelector('.answer-panel')"))
        click("answer"); layout("FHD answer"); b.screenshot("classroom-answer-fhd.png")
        check("teacher control keeps keyboard focus after reveal",b.eval("document.activeElement.dataset.action==='answer'"))
        click("solution"); layout("FHD solution"); b.screenshot("classroom-solution-fhd.png")
        for _ in range(8):
            if b.eval("document.querySelector('[data-action=step-next]').disabled"):
                break
            click("step-next"); layout("FHD next solution step")
        click("next"); check("next question starts hidden", b.eval("!document.querySelector('.reveal-panel') && document.querySelector('.classroom-counter').textContent.includes('2')"))
        b.key("ArrowLeft"); check("previous retains solution state", b.eval("!!document.querySelector('.solution-panel')"))
        b.key("ArrowRight"); b.key("h"); check("H hint shortcut", b.eval("!!document.querySelector('.hint-panel')"))
        b.key("Space"); check("Space answer shortcut", b.eval("!!document.querySelector('.answer-panel')"))
        b.key("s"); check("S solution shortcut", b.eval("!!document.querySelector('.solution-panel')"))
        click("help"); before=b.eval("document.querySelector('.classroom-counter').textContent"); b.key("ArrowRight")
        check("help blocks classroom shortcuts", b.eval("document.querySelector('.classroom-counter').textContent")==before)
        b.key("Escape"); check("Escape closes help", b.eval("!document.querySelector('dialog').open"))
        b.eval("(() => {const e=document.createElement('input');e.id='test-focus';document.body.append(e);e.focus();})()")
        b.key("ArrowRight");check("input focus blocks shortcuts",b.eval("document.querySelector('.classroom-counter').textContent")==before)
        b.eval("document.getElementById('test-focus').remove()")
        b.key("f"); b.wait_for("!!document.fullscreenElement");layout("FHD fullscreen")
        b.key("f"); b.wait_for("!document.fullscreenElement");check("F enters and leaves fullscreen",True)
        b.key("f"); b.wait_for("!!document.fullscreenElement");b.key("Escape");b.wait_for("!document.fullscreenElement");check("Escape leaves fullscreen",True)
        for _ in range(8):
            click("next")
        check("last question reachable", b.eval("document.querySelector('.classroom-counter').textContent.includes('10')"))
        click("next");check("classroom finishes without scores", b.eval("!!document.querySelector('.finish-class') && !document.querySelector('.stats-grid')"))
        b.click('.classroom-review > summary')
        check("classroom summary restores every problem and answer", b.eval("""(() => {
          const rows=[...document.querySelectorAll('.classroom-review .review-row')];
          return rows.length===__testProblems.length && rows.every((row,i)=>{
            const math=row.querySelectorAll('.math-line'), p=__testProblems[i];
            return math[0].innerHTML===FractionUI.equation(p) &&
              math[1].innerHTML==='<span class="math-word">정답</span>'+FractionUI.answer(p);
          });
        })()"""))
        for w,h in [(1920,1080),(1366,768),(390,844)]:
            b.viewport(w,h)
            check(f'classroom summary {w}x{h} fits horizontally',b.eval("""(() => {
              const parent=document.querySelector('.classroom-review').getBoundingClientRect();
              return document.documentElement.scrollWidth<=document.documentElement.clientWidth &&
                [...document.querySelectorAll('.classroom-review .math-line')].every(el=>{
                  const r=el.getBoundingClientRect();return r.left>=parent.left && r.right<=parent.right;
                });
            })()"""))
        b.viewport(1920,1080)
        b.eval('scrollTo(0,0)')
        b.screenshot('classroom-summary-fhd.png')
        check('classroom summary does not save personal history',b.eval('LearningStorage.list().length===0'))
        click("start");check("new set starts without refresh",b.eval("!!document.querySelector('.classroom-stage') && !document.querySelector('.reveal-panel')"))
        signature=b.eval("__testProblems[0].signature");click("new-problem");check("instant generation changes question",b.eval("__testProblems[0].signature")!=signature)

        # Harder and concept layouts: every solution step, all main reveal states.
        cases=[(4,'g4-addsub','mixed-sub'),(4,'g4-addsub','whole-minus-mixed'),(5,'g5-equivalence','equivalent'),(5,'g5-equivalence','simplify'),(5,'g5-equivalence','common'),(5,'g5-equivalence','common-denominator'),(5,'g5-equivalence','compare'),(5,'g5-addsub','borrow'),(5,'g5-multiply','mixed-multiply'),(5,'g5-multiply','proper-multiply'),(6,'g6-divide','mixed-divide')]
        for grade, section, kind in cases:
            configure(grade=grade,unit=section,kind=kind,difficulty='challenge')
            layout(f"FHD {section}/{kind} problem")
            click("answer");layout(f"FHD {section}/{kind} answer")
            click("solution")
            for i in range(12):
                layout(f"FHD {section}/{kind} solution {i+1}")
                if b.eval("document.querySelector('[data-action=step-next]').disabled"):
                    break
                click("step-next")
            click("visual");layout(f"FHD {section}/{kind} visual")
            options=b.eval("[...document.querySelectorAll('[data-action=visual-model]')].map(e=>e.dataset.value)")
            for model in options:
                click("visual-model",model);layout(f"FHD {section}/{kind} {model}")
            if kind=='proper-multiply': b.screenshot('classroom-area-fhd.png')
            if kind=='mixed-divide': b.screenshot('classroom-division-fhd.png')

        for w,h in [(1366,768),(1024,768),(768,1024),(3840,2160)]:
            b.viewport(w,h)
            configure(grade=5,unit='g5-addsub',kind='borrow',difficulty='challenge')
            layout(f"{w}x{h} problem")
            click('answer');layout(f"{w}x{h} answer")
            click('solution')
            for i in range(12):
                layout(f"{w}x{h} solution {i+1}")
                if b.eval("document.querySelector('[data-action=step-next]').disabled"):break
                click('step-next')
            click('visual');layout(f"{w}x{h} visual")
            b.screenshot(f'classroom-{w}x{h}.png')

        # The restored original natural-number minus mixed-number exercise is selectable and gradable.
        b.viewport(1366,768)
        b.navigate();click('mode','personal');click('grade',4)
        b.click('[data-setting="includeBorrow"]')
        setting('type','whole-minus-mixed')
        check('required borrowing stays enabled for natural minus mixed',b.eval("document.querySelector('[data-setting=includeBorrow]').checked && document.querySelector('[data-setting=includeBorrow]').disabled"))
        click('start');b.wait('.problem-equation')
        check('natural minus mixed displays a whole first operand',b.eval("__testProblems.every(p=>p.type==='whole-minus-mixed'&&p.operands[0].d===1) && document.querySelector('.problem-equation').firstElementChild.classList.contains('whole')"))
        answer_problem(multiply=2)
        check('natural minus mixed accepts an equivalent unreduced answer',b.eval("document.querySelector('.feedback').textContent.includes('정답이에요')"))
        for grade in [4,5]:
            for group,operator in [('addition','+'),('subtraction','-')]:
                configure('classroom',grade,f'g{grade}-addsub',group,count=20)
                check(f'grade {grade} {group} mixes only its operation',b.eval("__testProblems.length===20 && __testProblems.every(p=>p.operator==="+json.dumps(operator)+") && new Set(__testProblems.map(p=>p.type)).size>1"))
                click('settings')
                check(f'{group} keeps the mixed-number inclusion setting',b.eval("!!document.querySelector('[data-setting=includeMixed]')"))
                b.click('[data-setting="includeMixed"]')
                click('start');b.wait('.problem-equation')
                check(f'grade {grade} {group} excludes mixed-number types when disabled',b.eval("__testProblems.every(p=>!ProblemBank.getUnit(p.grade,p.unit).types.find(t=>t.id===p.type).mixed)"))

        # Personal mode: equivalence accepted, strict reduced form, attempts, history and wrong-problem replay.
        b.viewport(1366,768)
        configure('personal',4,'g4-addsub','proper-add',count=5)
        check('automatic numerator focus',b.eval("document.activeElement.id==='num'"))
        b.key('Tab');check('Tab moves numerator to denominator',b.eval("document.activeElement.id==='den'"))
        b.key('Enter');check('Enter validates empty answer',b.eval("!!document.querySelector('.feedback') && document.querySelector('.feedback').textContent.includes('입력')"))
        answer_problem(0,multiply=2)
        check('equivalent unreduced answer accepted in grade4',b.eval("document.querySelector('.feedback').textContent.includes('정답이에요')"))
        click('next');fill('num',0);fill('den',1);b.click('[type=submit]')
        check('wrong answer gets hint and retains input',b.eval("!!document.querySelector('.hint-panel') && document.querySelector('[name=num]').value==='0'"))
        answer_problem(1);click('next');click('solution');click('next');click('next');answer_problem(4);click('next')
        check('results count first success and retry distinctly',b.eval("document.querySelector('.stats-grid').textContent.includes('2 / 5') && document.querySelector('.stats-grid').textContent.includes('40%')"))
        record=b.eval("LearningStorage.list()[0]")
        check('record retains date/unit/type/time/attempts/wrong questions',record['correct']==3 and record['firstCorrect']==2 and len(record['wrongProblems'])==3 and len(record['attempts'])==5 and record['durationSeconds']>=0)
        click('review-current');check('replay starts exact wrong set',b.eval("document.querySelector('.problem-tag').textContent.includes('/ 3')"))
        b.navigate();click('history');check('history survives reload',b.eval("document.querySelectorAll('.history-row').length===1"));b.click('[data-action=review-history]');check('stored wrong replay works',b.eval("!!document.querySelector('.answer-form')"))

        for kind in ['equivalent','simplify','common-denominator','common','compare']:
            configure('personal',5,'g5-equivalence',kind,count=5)
            if kind=='simplify':
                answer_problem(0,multiply=2);check('unreduced value receives specific feedback',b.eval("document.querySelector('.feedback').textContent.includes('기약분수')"))
            answer_problem();check(f'personal input {kind}',b.eval("document.querySelector('.feedback').textContent.includes('정답이에요')"))

        b.viewport(390,844)
        configure('personal',5,'g5-addsub','mixed-add',difficulty='challenge',count=5)
        b.screenshot('personal-mobile.png')
        check('mobile personal no horizontal scroll',b.eval('document.documentElement.scrollWidth<=document.documentElement.clientWidth'))
        click('solution')
        for _ in range(12):
            check('mobile solution no horizontal scroll',b.eval('document.documentElement.scrollWidth<=document.documentElement.clientWidth'))
            if b.eval("document.querySelector('[data-action=step-next]').disabled"):break
            click('step-next')
        configure('personal',5,'g5-equivalence','common',count=5);answer_problem();check('mobile common entry works',b.eval("document.querySelector('.feedback').textContent.includes('정답이에요')"))
        b.navigate();b.screenshot('home-mobile.png');check('mobile home no horizontal scroll',b.eval('document.documentElement.scrollWidth<=document.documentElement.clientWidth'))
        brand=b.eval("(() => {const e=document.querySelector('.brand');return {whiteSpace:getComputedStyle(e).whiteSpace,height:e.getBoundingClientRect().height};})()")
        check('mobile brand stays on one line',brand['whiteSpace']=='nowrap' and brand['height']<=36,brand)
        # No server, fetch, ES-module loader or SDK is required when opening the HTML directly.
        b.command('Page.navigate',{'url':(ARTIFACTS.parents[1]/'index.html').as_uri()})
        b.wait_for("location.protocol==='file:' && document.readyState==='complete'")
        b.wait('.mode-card');click('mode','personal');click('start');b.wait('#answer-form')
        check('index.html directly opens and generates personal problems',b.eval("!!document.querySelector('.problem-equation')"))
        b.eval('document.body.offsetHeight')
        report['consoleErrors']=b.console_errors
        check('zero browser console errors',not b.console_errors)

    path=ARTIFACTS/'scenario-report.json'
    path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'checks':len(report['checks']),'layouts':len(report['layouts']),'failures':report['failures'],'report':str(path)},ensure_ascii=False,indent=2))
    if report['failures']:
        raise SystemExit(1)


if __name__=='__main__':
    run()
