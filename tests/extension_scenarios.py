"""Browser integration checks for optional timers, rewards, and demo contribution.

Run: python tests/extension_scenarios.py
Uses a dedicated local browser profile; no online ranking write is performed.
"""
import json
import time

from browser_test import ARTIFACTS, Browser


def run():
    report = {"checks": [], "layouts": [], "failures": []}

    def check(name, passed, detail=None):
        report["checks"].append({"name": name, "passed": bool(passed), "detail": detail})
        if not passed:
            report["failures"].append(name)

    browser = Browser(http_port=8768, debug_port=9226)
    browser.profile = ARTIFACTS / "extension-browser-profile"
    with browser as b:
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

        def configure(mode="classroom", seconds=30, auto=False, game=True, ranking=False,
                      grade=5, unit="g5-addsub", kind="borrow", difficulty="challenge"):
            b.navigate()
            click("mode", mode)
            click("grade", grade)
            click("unit", unit)
            setting("type", kind)
            click("difficulty", difficulty)
            setting("count", 5)
            setting("timerSeconds", seconds, "#timer-custom")
            if mode == "personal":
                setting("gamificationEnabled", game)
                setting("rankingEnabled", ranking)
                if ranking:
                    setting("rankingMode", "demo")
            else:
                setting("autoReveal", auto)
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

        b.viewport(1366, 768)
        configure("personal", seconds=1, grade=4, unit="g4-addsub", kind="proper-add", difficulty="normal")
        b.wait_for("document.querySelector('[data-timer]').classList.contains('timer-expired')")
        check("personal expiry leaves answer entry available", b.eval("!!document.querySelector('#answer-form') && !document.querySelector('.study-reveal') && document.querySelector('.problem-tag').textContent.includes('문제 1')"))
        answer(0)
        check("answer accepted after personal timeout without speed or combo bonus", b.eval("document.querySelector('.session-growth').textContent.includes('성장 점수 11점') && document.querySelector('.session-growth').textContent.includes('연속 정답 0개')"))
        click("finish")
        timeout_record = b.eval("LearningStorage.list()[0]")
        check("timeout and timer settings saved", timeout_record["timeoutCount"] == 1 and timeout_record["timerSeconds"] == 1 and timeout_record["timerEnabled"] and not timeout_record["completed"])

        configure("personal", seconds=30, grade=4, unit="g4-addsub", kind="proper-add", difficulty="normal")
        click("timer-toggle")
        check("personal timer pause button works", not timer()["running"])
        click("timer-toggle")
        check("personal timer start button works", timer()["running"])
        answer(0)
        check("solved question stops timer and disables both controls", not timer()["running"] and b.eval("[...document.querySelectorAll('[data-timer] button')].every(e=>e.disabled)"))
        frozen = timer()["elapsedSeconds"]
        time.sleep(0.2)
        check("solved timer remains stopped", timer()["elapsedSeconds"] == frozen)
        click("next")
        click("solution")
        check("revealing personal solution stops timer and locks controls", not timer()["running"] and b.eval("[...document.querySelectorAll('[data-timer] button')].every(e=>e.disabled)"))

        for width, height in [(1366, 768), (768, 1024), (390, 844)]:
            b.viewport(width, height)
            configure("personal", seconds=30)
            layout(f"{width}x{height} personal timer")
            b.screenshot(f"timer-personal-{width}x{height}.png")
            click("solution")
            layout(f"{width}x{height} personal timer solution")

        # Begin a clean study history for the exact demo contribution assertion.
        b.viewport(1366, 768)
        b.navigate()
        b.eval("localStorage.clear()")
        b.navigate()
        selected = b.eval("ClassRanking.selectClass({schoolName:'테스트초등학교',region:'테스트 지역',grade:4,className:'1'})")
        check("test class selected locally", selected["ok"])
        configure("personal", seconds=30, ranking=True, grade=4, unit="g4-addsub", kind="proper-add", difficulty="normal")
        for index in range(5):
            answer(index)
            click("next")
        b.wait_for("LearningStorage.list()[0]?.classContributionStatus==='demo'")
        record = b.eval("LearningStorage.list()[0]")
        check("completed timed study saves rewards and optional history fields", record["completed"] and record["correct"] == 5 and record["firstCorrect"] == 5 and record["score"] == 81 and record["comboMax"] == 5 and record["expEarned"] == 50 and record["averageSolveSeconds"] > 0 and record["timeoutCount"] == 0, record)
        check("demo completion stores participation receipt", record["rankingEnabled"] and record["rankingMode"] == "demo" and record["classContributionStatus"] == "demo" and record["classScoreContribution"] == 55)
        check("result displays reward and demo status", b.eval("document.querySelector('.record-growth').textContent.includes('성장 81점') && document.querySelector('.record-growth').textContent.includes('데모 반영 완료 (55점)')"))
        ranking = b.eval("ClassRanking.getRankingData({mode:'demo'})")
        check("five solved answers contribute to selected demo class", ranking["ourClass"]["score"] == 55 and ranking["ourClass"]["totalSolved"] == 5 and ranking["ourClass"]["sessions"] == 1)
        duplicate = b.eval("ClassRanking.updateClassScore(LearningStorage.list()[0],{mode:'demo'})")
        ranking_again = b.eval("ClassRanking.getRankingData({mode:'demo'})")
        check("repeated demo contribution does not add points twice", duplicate["ok"] and duplicate["duplicate"] and ranking_again["ourClass"] == ranking["ourClass"])
        profile = b.eval("LearningGame.profile()")
        click("growth")
        check("growth page shows earned XP and first badge", profile["xp"] == 50 and profile["totalSolved"] == 5 and profile["completedSessions"] == 1 and b.eval("document.querySelector('.growth-profile').textContent.includes('첫 걸음') && document.querySelector('.growth-profile').textContent.includes('경험치 50')"))
        b.screenshot("growth-earned.png")
        b.navigate()
        click("history")
        check("history reload preserves optional fields and demo status", b.eval("document.querySelector('.record-growth').textContent.includes('데모 반영 완료')") and b.eval("LearningStorage.list()[0].score") == 81)
        check("reload does not reissue rewards", b.eval("LearningGame.profile()") == profile)

        configure("personal", seconds=0, game=False, grade=4, unit="g4-addsub", kind="proper-add", difficulty="normal")
        check("disabled tools omit timer and score UI", b.eval("!document.querySelector('[data-timer]') && !document.querySelector('.session-growth')"))
        for index in range(5):
            answer(index)
            click("next")
        disabled_record = b.eval("LearningStorage.list()[0]")
        check("disabled rewards do not change accumulated growth", disabled_record["score"] == 0 and disabled_record["expEarned"] == 0 and b.eval("LearningGame.profile()") == profile)
        b.eval("document.body.offsetHeight")
        requests = [event["params"]["request"]["url"] for event in b.events
                    if event.get("method") == "Network.requestWillBeSent"]
        remote = [url for url in requests if url.startswith("http") and not url.startswith(b.base_url)]
        check("timer reward and demo flow needs no external request", not remote, remote)
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
