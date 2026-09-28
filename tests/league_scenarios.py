"""League boundaries, weekly results and guarded reset against the local Firestore fixture."""
import json
from browser_test import ARTIFACTS, Browser
from competition_fixture import install, enter, field


def run():
    report = {'checks': [], 'failures': []}

    def check(name, passed, detail=None):
        report['checks'].append({'name': name, 'passed': bool(passed), 'detail': detail})
        if not passed:
            report['failures'].append(name)

    browser = Browser(http_port=8771, debug_port=9229)
    browser.profile = ARTIFACTS / 'league-browser-profile'
    with browser as b:
        install(b)
        b.navigate()
        b.eval('localStorage.clear();sessionStorage.clear()')
        b.navigate(); b.click('[data-action="mode"][data-value="personal"]'); enter(b)
        identity = b.eval('WeeklyCompetition.getIdentity()')
        b.eval("""(()=>{
          const who=WeeklyCompetition.getIdentity(), week=WeeklyCompetition.getWeek();
          globalThis.__leagueIdentity=who;
          for(const weekId of [week.id,week.prevId]) {
            for(let i=0;i<61;i++) {
              const classroom=i===60 ? who.classroom : {...who.classroom,schoolName:`리그테스트${i}초등학교`,id:`[${who.classroom.region}] 리그테스트${i}초등학교 ${who.classroom.grade}학년 ${who.classroom.className}반`};
              const playerId=`${classroom.id}::${who.nickname}`, path=`weeklyCompetitionPlayers_${weekId}/${playerId}`;
              const old=__competitionFixture.documents.get(path)||{};
              __competitionFixture.documents.set(path,{...old,...who,classroom,playerId,weekId,score:weekId===week.id ? 610-i*10 : i*10+10,sessions:1});
            }
          }
          __competitionFixture.persist();
        })()""")
        b.click('[data-action="ranking"]'); b.click('[data-action="competition-kind"][data-value="individual"]')
        b.wait_for("document.querySelectorAll('.competition-rank-row').length===122")
        for board in ['current', 'prev']:
            prefix = f'.competition-board:has(#competition-{board}-title)'
            for league, count, first, last in [('diamond',5,1,5),('gold',5,6,10),('silver',5,11,15),('bronze',46,16,61)]:
                selector = f'{prefix} [data-league="{league}"] .competition-rank-row'
                values = b.eval('Array.from(document.querySelectorAll('+json.dumps(selector)+'),e=>({rank:Number(e.dataset.leagueRank),overall:Number(e.dataset.overallRank)}))')
                check(f'{board} {league} boundaries and local ranks', len(values)==count and values[0]=={'rank':1,'overall':first} and values[-1]=={'rank':count,'overall':last})
            check(board+' gold silver bronze trophies', b.eval('Array.from(document.querySelectorAll('+json.dumps(prefix+' .competition-trophy')+'),e=>e.getAttribute("aria-label"))') == ['다이아몬드리그 1위 금 트로피','다이아몬드리그 2위 은 트로피','다이아몬드리그 3위 동 트로피'])
            check(board+' other leagues each have three medals', b.eval('document.querySelectorAll('+json.dumps(prefix+' .rank-medal')+').length') == 9)
        check('Current and previous league membership uses each week independently', b.eval("document.querySelector('.competition-board:first-child .competition-rank-own').dataset.leagueRank==='46' && document.querySelector('.competition-board:nth-child(2) [data-league=diamond] .competition-rank-row:first-child .competition-rank-name small').textContent.includes(__leagueIdentity.classroom.schoolName)"))
        b.eval("__competitionFixture.documents.get('weeklyCompetitionPlayers_'+__leagueIdentity.weekId+'/'+__leagueIdentity.playerId).score=9999;__competitionFixture.persist();__competitionFixture.emit()")
        b.wait_for("document.querySelector('.competition-board:first-child [data-league=diamond] .competition-rank-own')?.dataset.leagueRank==='1'")
        check('Realtime score promotes bronze participant to diamond', b.eval("document.querySelector('.competition-board:first-child [data-league=diamond] .competition-rank-own .competition-trophy').getAttribute('aria-label').includes('1위 금')"))
        for width,height in [(1920,1080),(1366,768),(768,1024),(390,844)]:
            b.viewport(width,height)
            check(f'League layout {width}x{height}', b.eval("document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('.competition-league,.competition-trophy')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;})"))
            b.screenshot(f'leagues-{width}.png')
        # Real week rollover reuses stored previous results rather than migrating scores.
        b.eval('__competitionFixture.offset=WeeklyCompetition.getWeek().endMs-Date.now()+1')
        b.click('[data-action="competition-refresh"]')
        b.wait_for("document.querySelectorAll('.competition-board:first-child .competition-rank-row').length===0 && document.querySelectorAll('.competition-board:nth-child(2) .competition-rank-row').length===61")
        check('Monday rollover preserves completed week leagues', b.eval("document.querySelector('.competition-board:nth-child(2) [data-league=diamond] .competition-rank-own .competition-rank-score').textContent==='9,999점'"))
        b.eval('__competitionFixture.offset=0')
        b.click('[data-action="home"]')
        check('League subscriptions cleaned when leaving', b.eval('__competitionFixture.listeners.size===0'))
        b.click('[data-action="mode"][data-value="personal"]')
        field(b,'#competition-pin','123456','input')
        check('Entry uses plain password wording', b.eval("document.querySelector('label[for=competition-pin]').textContent==='비밀번호 입력 (숫자 6자리)' && !document.querySelector('.competition-page').textContent.includes('PIN')"))
        before = b.eval("({documents:JSON.stringify([...__competitionFixture.documents]),draft:localStorage.getItem(WeeklyCompetition.keys.drafts),history:localStorage.getItem(LearningStorage.key)})")
        b.click('[data-action="competition-new-draft"]'); b.click('[data-action="competition-new-draft"]')
        check('Repeated initial taps do not reset', b.eval('localStorage.getItem(WeeklyCompetition.keys.drafts)')==before['draft'])
        check('Confirm disabled before acknowledgement', b.eval("document.querySelector('[data-action=competition-reset-confirm]').disabled"))
        b.eval("document.querySelector('[data-action=competition-reset-confirm]').click()")
        check('Disabled confirmation cannot mutate draft', b.eval('localStorage.getItem(WeeklyCompetition.keys.drafts)')==before['draft'])
        for width,height in [(1920,1080),(1366,768),(768,1024),(390,844)]:
            b.viewport(width,height)
            check(f'Reset layout {width}x{height}', b.eval("document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('.competition-reset button')].every(e=>{const r=e.getBoundingClientRect();return r.width>40&&r.height>=44&&r.left>=0&&r.right<=innerWidth+1;})"))
            b.screenshot(f'password-reset-{width}.png')
        b.click('#competition-reset-ack'); b.click('[data-action="competition-reset-cancel"]')
        check('Cancel retains nickname and password', b.eval("document.querySelector('#competition-pin').value==='123456' && document.querySelector('#competition-nickname').value") == identity['nickname'])
        b.click('[data-action="competition-new-draft"]')
        check('New confirmation starts unchecked', b.eval("!document.querySelector('#competition-reset-ack').checked && document.querySelector('[data-action=competition-reset-confirm]').disabled"))
        b.click('#competition-reset-ack'); b.click('[data-action="competition-reset-confirm"]')
        check('Acknowledged reset empties inputs and starts fresh draft', b.eval("document.querySelector('#competition-pin').value==='' && document.querySelector('#competition-nickname').value==='' && WeeklyCompetition.getDraft(ClassRanking.getSelection()).rolls===0 && !WeeklyCompetition.getDraft(ClassRanking.getSelection()).confirmed"))
        check('Reset keeps server scores and local history', b.eval('JSON.stringify([...__competitionFixture.documents])')==before['documents'] and b.eval('localStorage.getItem(LearningStorage.key)')==before['history'])
        b.click('[data-action="competition-roll"]')
        field(b,'#competition-pin','654321','input'); field(b,'#competition-pin-confirm','654322','input')
        b.click('[data-action="competition-confirm"]')
        check('Mismatch error is understandable', b.eval("document.querySelector('.competition-entry-message').textContent.includes('두 비밀번호가 달라요')"))
        check('Mismatch leaves server data unchanged', b.eval('JSON.stringify([...__competitionFixture.documents])')==before['documents'])
        check('No browser console errors', not b.console_errors, b.console_errors)
        report['consoleErrors']=b.console_errors
    path=ARTIFACTS/'league-report.json'
    path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'checks':len(report['checks']),'failures':report['failures'],'report':str(path)},ensure_ascii=False))
    if report['failures']:
        raise SystemExit(1)


if __name__ == '__main__':
    run()
