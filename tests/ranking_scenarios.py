"""Ranking UI integration checks. Online reads use an injected local provider.

Run: python tests/ranking_scenarios.py
No Firebase request or online contribution is made by these scenarios.
"""
import json

from browser_test import ARTIFACTS, WORKSPACE, Browser


def run():
    report = {"checks": [], "failures": [], "screenshots": []}

    def check(name, passed):
        report["checks"].append({"name": name, "passed": bool(passed)})
        if not passed:
            report["failures"].append(name)

    browser = Browser(http_port=8766, debug_port=9224)
    browser.profile = WORKSPACE / "tests" / ".browser-profile-ranking"
    with browser as b:
        b.command("Page.addScriptToEvaluateOnNewDocument", {"source": """
          (() => {
            const fixture=globalThis.__rankingFixture={reads:[],writes:0,phase:'ready',rows:[],ourClass:null};
            let ranking,bank;
            Object.defineProperty(globalThis,'ClassRanking',{configurable:true,get(){return ranking},set(api){
              ranking={...api,...api.createRepository({onlineProvider:{
                read(args){
                  fixture.reads.push(args);
                  if(fixture.phase==='error')return Promise.reject(new Error('Simulated read failure'));
                  if(fixture.phase==='pending')return new Promise(resolve=>fixture.resolve=resolve);
                  return Promise.resolve({rows:fixture.rows,ourClass:fixture.ourClass});
                },
                contribute(){fixture.writes++;throw new Error('Online writes are disabled in this test');}
              }})};
            }});
            Object.defineProperty(globalThis,'ProblemBank',{configurable:true,get(){return bank},set(api){
              bank={...api,generateSet(...args){const result=api.generateSet(...args);globalThis.__testProblems=result;return result;}};
            }});
          })();
        """})

        def click(action, value=None):
            selector = f'[data-action="{action}"]'
            if value is not None:
                selector += f'[data-value="{value}"]'
            b.click(selector)

        def field(selector, value, event="change"):
            b.eval("(() => {const e=document.querySelector(" + json.dumps(selector) + ");"
                   "e.value=" + json.dumps(str(value)) + ";e.dispatchEvent(new Event("
                   + json.dumps(event) + ",{bubbles:true}));})()")

        b.navigate()
        b.eval("localStorage.clear()")
        b.navigate()
        click("ranking")
        check("opening ranking performs no online read", b.eval("__rankingFixture.reads.length===0"))
        check("online is the initial explicit mode", b.eval("document.querySelector('[data-action=ranking-mode][data-value=online]').getAttribute('aria-pressed')==='true'"))
        field("#school-query", "서")
        click("ranking-search")
        check("school query requires two characters", b.eval("document.querySelector('#school-search-status').textContent.includes('두 글자')"))
        field("#school-query", "서울")
        click("ranking-search")
        b.wait(".ranking-school")
        check("actual bundled school data is searchable", b.eval("document.querySelectorAll('.ranking-school').length>0"))
        click("ranking-school-pick", 0)
        field("#ranking-grade", 6)
        field("#ranking-class", 30)
        click("ranking-register")
        check("school grade and class registration is persisted", b.eval("ClassRanking.getSelection().grade===6&&ClassRanking.getSelection().className==='30'&&!!JSON.parse(localStorage.getItem(ClassRanking.keys.selection)).selection"))
        click("ranking-mode", "demo")
        click("ranking-refresh")
        b.wait(".ranking-table")
        check("demo explicitly loads examples without online reads", b.eval("document.querySelectorAll('.ranking-table tbody tr').length===5&&__rankingFixture.reads.length===0"))
        check("view mode and learning participation are explained separately", b.eval("document.querySelector('.ranking-board').textContent.includes('별개')"))

        # Complete an actual personal session; only its local demo contribution is permitted.
        click("home")
        click("mode", "personal")
        field('[data-setting="type"]', "proper-add")
        field('[data-setting="count"]', 5)
        b.click('[data-setting="rankingEnabled"]')
        check("ranking view mode does not change learning participation mode", b.eval("document.querySelector('#ranking-mode-select').value==='online'"))
        field("#ranking-mode-select", "demo")
        click("start")
        for index in range(5):
            answer = b.eval(f"__testProblems[{index}].answer")
            field('[name="num"]', answer["n"], "input")
            field('[name="den"]', answer["d"], "input")
            b.click('[type="submit"]')
            click("next")
        b.wait_for("LearningStorage.list()[0]?.classContributionStatus==='demo'")
        check("completed personal session contributes once in demo", b.eval("LearningStorage.list()[0].completed&&LearningStorage.list()[0].firstCorrect===5&&LearningStorage.list()[0].classScoreContribution>0&&__rankingFixture.writes===0"))
        click("ranking")
        click("ranking-refresh")
        b.wait(".ranking-ours")
        check("our demo class is highlighted with its contribution", b.eval("Number(document.querySelector('.ranking-ours .ranking-score').textContent.replaceAll(',',''))===LearningStorage.list()[0].classScoreContribution"))
        for width, height in [(1920, 1080), (1366, 768), (390, 844)]:
            b.viewport(width, height)
            b.eval("scrollTo(0,0)")
            check(f"ranking {width}x{height} has no horizontal page overflow", b.eval("document.documentElement.scrollWidth<=innerWidth"))
            report["screenshots"].append(str(b.screenshot(f"ranking-{width}x{height}.png").relative_to(WORKSPACE)))
        b.viewport(1366, 768)
        click("ranking-week", "prev")
        click("ranking-refresh")
        b.wait(".ranking-table")
        check("previous demo week has separate class records", b.eval("!document.querySelector('.ranking-ours')"))
        click("ranking-week", "current")

        # Exercise the actual online UI against the repository's injectable provider.
        b.eval("""(() => {
          __rankingFixture.rows=Array.from({length:55},(_,i)=>({id:'mock-'+i,schoolName:'Mock school '+i,region:'Test',grade:4,className:'1',score:i+20,sessions:1}));
          __rankingFixture.ourClass={...ClassRanking.getSelection(),score:1,sessions:1};
        })()""")
        click("ranking-mode", "online")
        click("ranking-refresh")
        b.wait(".ranking-ours")
        check("online sorts and limits to fifty plus our outside class", b.eval("document.querySelectorAll('.ranking-table tbody tr').length===51&&document.querySelector('.ranking-table tbody .ranking-score').textContent==='74'&&document.querySelector('.ranking-ours').textContent.includes('목록 밖')"))
        check("online current collection is separate from legacy", b.eval("__rankingFixture.reads.at(-1).collection==='classGrowthRankings_'+ClassRanking.getWeekIds().current"))
        click("ranking-mode", "legacy")
        click("ranking-week", "prev")
        click("ranking-refresh")
        b.wait(".ranking-table")
        check("legacy reads its previous-week collection", b.eval("__rankingFixture.reads.at(-1).collection==='classRankings_'+ClassRanking.getWeekIds().prev&&document.querySelector('.ranking-board').textContent.includes('합산하지')"))
        b.eval("__rankingFixture.phase='error'")
        click("ranking-refresh")
        b.wait(".ranking-empty.ranking-error")
        check("failed online read shows retry without automatic demo", b.eval("document.querySelector('.ranking-error').textContent.includes('다시 시도')&&document.querySelector('[data-action=ranking-mode][data-value=legacy]').getAttribute('aria-pressed')==='true'"))
        b.eval("__rankingFixture.phase='ready';__rankingFixture.rows=[];__rankingFixture.ourClass=null")
        b.click('.ranking-empty [data-action="ranking-refresh"]')
        b.wait_for("document.querySelector('.ranking-empty')?.textContent.includes('아직 학급 기록')")
        check("retry recovers to a genuine empty state", True)
        b.eval("__rankingFixture.phase='pending'")
        click("ranking-refresh")
        b.wait_for("document.querySelector('.ranking-content').getAttribute('aria-busy')==='true'")
        check("pending read displays a loading state", b.eval("document.querySelector('.ranking-empty').textContent.includes('불러오고')"))
        click("ranking-mode", "demo")
        click("ranking-refresh")
        b.wait(".ranking-table")
        b.eval("__rankingFixture.resolve({rows:[{id:'stale',schoolName:'STALE-ONLINE',region:'Test',grade:4,className:'1',score:999}],ourClass:null})")
        check("late online response cannot replace selected demo", b.eval("!document.querySelector('.ranking-board').textContent.includes('STALE-ONLINE')&&document.querySelector('[data-action=ranking-mode][data-value=demo]').getAttribute('aria-pressed')==='true'"))
        click("ranking-clear")
        check("class selection can be cleared", b.eval("ClassRanking.getSelection()===null&&!document.querySelector('.ranking-current-class')"))
        check("no online contribution was attempted", b.eval("__rankingFixture.writes===0"))
        remote_requests = [event["params"]["request"]["url"] for event in b.events
                           if event.get("method") == "Network.requestWillBeSent"
                           and event["params"]["request"]["url"].startswith("https://")]
        check("all ranking scenarios remain local", not remote_requests)
        b.eval("document.body.offsetHeight")
        report["consoleErrors"] = b.console_errors
        check("zero browser console errors", not b.console_errors)

    path = ARTIFACTS / "ranking-report.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"checks": len(report["checks"]), "failures": report["failures"], "report": str(path)}, ensure_ascii=False, indent=2))
    if report["failures"]:
        raise SystemExit(1)


if __name__ == "__main__":
    run()
