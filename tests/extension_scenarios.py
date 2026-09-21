"""Browser integration checks for classroom timers and removal of personal learning tools.

Run: python tests/extension_scenarios.py
Uses a dedicated local browser profile; no online ranking write is performed.
"""
import json
import time

from browser_test import ARTIFACTS, Browser
from competition_fixture import install, enter


def run():
    report = {"checks": [], "layouts": [], "failures": []}

    def check(name, passed, detail=None):
        report["checks"].append({"name": name, "passed": bool(passed), "detail": detail})
        if not passed:
            report["failures"].append(name)

    browser = Browser(http_port=8768, debug_port=9226)
    browser.profile = ARTIFACTS / "extension-browser-profile"
    with browser as b:
        install(b)
        # Observers only exist in this browser. The app has no exposed session API.
        b.command("Page.addScriptToEvaluateOnNewDocument", {"source": """
          (() => {
            let bank, timer;
            Object.defineProperty(globalThis, 'ProblemBank', {
              configurable:true, get(){return bank}, set(value){bank={...value,
                generateSet(...args){const result=value.generateSet(...args);
                  globalThis.__testProblems=result; return result;}};}
            });
            globalThis.__testTimers=[];
            Object.defineProperty(globalThis, 'StudyTimer', {
              configurable:true, get(){return timer}, set(value){timer={...value,
                create(...args){const result=value.create(...args);
                  globalThis.__testTimers.push(result); return result;}};}
            });
          })();
        """})
        b.navigate()
        b.eval("localStorage.clear()")
        b.navigate()

        def click(action, value=None):
            selector = f'[data-action="{action}"]'
            if value is not None:
                selector += f'[data-value="{value}"]'
            b.click(selector)

        def setting(name, value, selector=None):
            selector = selector or f'[data-setting="{name}"]'
            b.eval("""(() => {const e=document.querySelector(SELECTOR);
              if(e.type==='checkbox') e.checked=VALUE; else e.value=String(VALUE);
              e.dispatchEvent(new Event('change',{bubbles:true}));})()"""
                   .replace("SELECTOR", json.dumps(selector)).replace("VALUE", json.dumps(value)))

        def configure(mode="classroom", seconds=30, auto=False,
                      grade=5, unit="g5-addsub", kind="borrow", difficulty="challenge"):
            b.navigate()
            click("mode", mode)
            if mode == "personal":
                enter(b)
            click("grade", grade)
            click("unit", unit)
            if mode == "personal":
                click("problem-type", kind)
                click("count", 5)
            else:
                setting("type", kind)
                setting("count", 5)
                setting("timerSeconds", seconds, "#timer-custom")
                setting("autoReveal", auto)
            click("difficulty", difficulty)
            click("start")
            b.wait(".problem-equation")

        def timer(index=-1):
            return b.eval(f"__testTimers.at({index}).snapshot()")

        def remaining():
            return b.eval("document.querySelector('[data-timer-value]').textContent")

        def fill(name, value):
            b.eval("""(() => {const e=document.querySelector(SELECTOR);e.value=VALUE;
              e.dispatchEvent(new Event('input',{bubbles:true}));})()"""
                   .replace("SELECTOR", json.dumps(f'[name="{name}"]'))
                   .replace("VALUE", json.dumps(str(value))))

        def answer(index):
            expected = b.eval(f"__testProblems[{index}].answer")
            fill("num", expected["n"])
            fill("den", expected["d"])
            b.click('[type="submit"]')
            b.wait_for("!!document.querySelector('.feedback:not(.retry)')")

        def layout(name, classroom=False):
            result = b.eval("""(() => {
              const w=innerWidth,h=innerHeight,root=document.documentElement;
              const selectors=CLASSROOM ? '.classroom-header,.classroom-header > *,.study-timer,.study-timer button,.classroom-stage .fraction,.classroom-stage .math-line,.teacher-controls button,.classroom-toolbar button' : '.site-header,.site-header button,.study-timer,.study-timer button,.problem-equation';
              const out=[...document.querySelectorAll(selectors)].filter(e=>{
                const r=e.getBoundingClientRect();return r.width&&r.height&&
                (r.left < -1 || r.right > w+1 || (CLASSROOM && (r.top < -1 || r.bottom > h+1)));
              }).map(e=>({class:e.className,text:e.textContent.slice(0,100)}));
              const equation=document.querySelector('.problem-equation');
              return {width:w,height:h,scrollWidth:root.scrollWidth,scrollHeight:root.scrollHeight,
                out,font:equation?parseFloat(getComputedStyle(equation).fontSize):null};
            })()""".replace("CLASSROOM", "true" if classroom else "false"))
            report["layouts"].append({"name": name, **result})
            check(name, not result["out"] and result["scrollWidth"] <= result["width"]
                  and (not classroom or result["scrollHeight"] <= result["height"]), result)
            return result

        check("all extension modules loaded", b.eval("['StudyTimer','LearningGame','ClassRanking','SessionExtras','RankingUI'].every(k=>!!globalThis[k])"))
        click("mode", "classroom")
        check("timer disabled by default", b.eval("document.querySelector('#timer-select').value==='0'"))
        setting("timerSeconds", "custom", "#timer-select")
        check("custom timer choice focuses seconds input", b.eval("document.activeElement.id==='timer-custom'"))
        setting("timerSeconds", 45, "#timer-custom")
        check("custom timer value kept", b.eval("document.querySelector('#timer-select').value==='custom' && document.querySelector('#timer-custom').value==='45'"))
        for invalid in [-1, 3601, 1.5, ""]:
            setting("timerSeconds", invalid, "#timer-custom")
            check(f"invalid timer {invalid!r} preserves previous value", b.eval("document.querySelector('#timer-custom').value==='45'"))
        setting("timerSeconds", 20, "#timer-select")
        check("preset timer updates custom input", b.eval("document.querySelector('#timer-custom').value==='20'"))

        configure()
        check("classroom timer begins running", timer()["running"] and remaining() == "0:30")
        first = layout("FHD timer classroom problem", True)
        check("FHD timer preserves large equation", first["font"] >= 120)
        b.screenshot("timer-classroom-fhd.png")
        b.key("t")
        check("T pauses timer", not timer()["running"])
        frozen = timer()["elapsedSeconds"]
        time.sleep(1.1)
        check("paused timer does not consume time", timer()["elapsedSeconds"] == frozen)
        b.key("t")
        check("T resumes timer", timer()["running"])
        b.wait_for("__testTimers.at(-1).snapshot().remaining<30")
        b.key("r")
        check("R resets timer and leaves it paused", remaining() == "0:30" and not timer()["running"])
        click("timer-toggle")
        click("help")
        frozen = timer()["elapsedSeconds"]
        b.key("t")
        time.sleep(0.2)
        check("help pauses timer and blocks T", not timer()["running"] and timer()["elapsedSeconds"] == frozen)
        b.key("Escape")
        click("timer-toggle")
        click("settings")
        frozen = timer()["elapsedSeconds"]
        time.sleep(1.1)
        check("settings pauses existing question", not timer()["running"] and timer()["elapsedSeconds"] == frozen)
        click("resume")
        check("return from settings keeps paused timer", not timer()["running"])
        click("timer-toggle")
        click("next")
        check("next question pauses old timer and starts new timer", not timer(0)["running"] and timer(1)["running"])
        click("previous")
        check("previous question restores its paused time", not timer(0)["running"] and not timer(1)["running"])
        click("timer-toggle")
        old_count = b.eval("__testTimers.length")
        click("new-problem")
        check("replacement question destroys old timer and starts a fresh one", not timer(0)["running"] and b.eval("__testTimers.length") == old_count + 1 and timer()["running"])
        click("answer")
        layout("FHD timer classroom answer", True)
        click("solution")
        layout("FHD timer classroom solution", True)
        b.screenshot("timer-classroom-solution-fhd.png")

        for width, height in [(1366, 768), (1024, 768), (768, 1024)]:
            b.viewport(width, height)
            configure()
            layout(f"{width}x{height} timer classroom problem", True)
            click("answer")
            click("solution")
            layout(f"{width}x{height} timer classroom solution", True)
            click("visual")
            layout(f"{width}x{height} timer classroom visual", True)
            b.screenshot(f"timer-classroom-{width}x{height}.png")

        b.viewport(1920, 1080)
        configure(seconds=1)
        b.wait_for("document.querySelector('[data-timer]').classList.contains('timer-expired')")
        check("classroom expiry does not reveal or advance by default", b.eval("!document.querySelector('.reveal-panel') && document.querySelector('.classroom-counter').textContent.includes('문제 1')"))
        check("expired timer can be reset", b.eval("!document.querySelector('[data-action=timer-reset]').disabled"))
        click("timer-reset")
        check("expired reset clears expiry and pauses", not timer()["expired"] and not timer()["running"] and remaining() == "0:01")
        configure(seconds=1, auto=True)
        b.wait(".answer-panel")
        check("auto reveal shows answer on expiry and keeps question", b.eval("document.querySelector('.classroom-counter').textContent.includes('문제 1')") and timer()["expired"])

        # Personal timers and growth profiles were explicitly removed. Scoring still
        # feeds weekly competition, and old growth data must remain untouched.
        b.viewport(1366, 768)
        b.navigate()
        b.eval("localStorage.setItem(LearningGame.key, JSON.stringify({version:1,legacySentinel:'keep'}))")
        legacy = b.eval("localStorage.getItem(LearningGame.key)")
        configure("personal", grade=4, unit="g4-addsub", kind="proper-add", difficulty="normal")
        check("personal mode creates no timer", b.eval("__testTimers.length===0 && !document.querySelector('[data-timer]')"))
        check("removed growth page is absent from navigation", b.eval("!document.querySelector('[data-action=growth]')"))
        for width, height in [(1366, 768), (768, 1024), (390, 844)]:
            b.viewport(width, height)
            layout(f"{width}x{height} personal without timer")
            b.screenshot(f"personal-no-timer-{width}x{height}.png")
        b.key('t');b.key('r')
        check("personal T and R do not create a background timer", b.eval("__testTimers.length===0"))
        for index in range(5):
            answer(index)
            click("next")
        b.wait_for("LearningStorage.list()[0]?.classContributionStatus==='synced'")
        record = b.eval("LearningStorage.list()[0]")
        check("personal completion retains untimed score and record", record['completed'] and record['firstCorrect']==5 and record['score']==2250 and not record['timerEnabled'] and record['timerSeconds']==0,record)
        check("removed growth issues no experience or badges",record['expEarned']==0 and record['badgesEarned']==[])
        check("legacy growth data is preserved",b.eval("localStorage.getItem(LearningGame.key)")==legacy)
        b.navigate();click('history')
        check("history reload preserves competition contribution",b.eval("document.querySelector('.record-growth').textContent.includes('랭킹 반영 완료') && LearningStorage.list()[0].score===2250"))
        configure("personal", grade=4, unit="g4-addsub", kind="all", difficulty="normal")
        b.viewport(390,844)
        for index in range(5):
            answer(index)
            if index == 0:
                check("mixed practice awards the advertised 1000 plus first-attempt bonus",b.eval("document.querySelector('.score-burst strong').textContent==='+1050점'"))
                b.eval("new Promise(resolve=>setTimeout(resolve,400))")
                layout('mobile reward animation')
                b.screenshot('score-answer-mobile.png')
                b.command('Emulation.setEmulatedMedia', {'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
                check('reduced motion hides transient burst but keeps earned score',b.eval("getComputedStyle(document.querySelector('.score-burst')).display==='none' && document.querySelector('.session-growth').textContent.includes('1050점')"))
                b.command('Emulation.setEmulatedMedia', {'features':[]})
            click('next')
        b.wait_for("LearningStorage.list()[0]?.classContributionStatus==='synced'")
        check('mixed practice large total survives saving and ranking submission',b.eval("LearningStorage.list()[0].score===6250 && LearningStorage.list()[0].classScoreContribution===6250 && LearningStorage.list()[0].scoringVersion===2"))
        b.eval("new Promise(resolve=>setTimeout(resolve,750))")
        b.eval("scrollTo(0,0)")
        b.screenshot('score-results-mobile.png')
        configure(seconds=0)
        check("untimed classroom creates no timer", b.eval("__testTimers.length===0 && !document.querySelector('[data-timer]')"))
        configure(seconds=30)
        click('finish')
        check("classroom finish destroys background timers",b.eval("__testTimers.every(t=>!t.snapshot().running)"))
        click('home')
        check("home leaves no running classroom timer",b.eval("__testTimers.every(t=>!t.snapshot().running)"))
        b.eval("document.body.offsetHeight")
        requests = [event["params"]["request"]["url"] for event in b.events
                    if event.get("method") == "Network.requestWillBeSent"]
        remote = [url for url in requests if url.startswith("http") and not url.startswith(b.base_url)]
        check("classroom timer and fixture competition need no external request", not remote, remote)
        report["consoleErrors"] = b.console_errors
        check("extension browser console has no errors", not b.console_errors, b.console_errors)

    path = ARTIFACTS / "extension-report.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"checks": len(report["checks"]), "layouts": len(report["layouts"]),
                      "failures": report["failures"], "report": str(path)}, ensure_ascii=False, indent=2))
    if report["failures"]:
        raise SystemExit(1)


if __name__ == "__main__":
    run()
