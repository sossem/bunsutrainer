"""Actual weekly competition UI against a local Firestore fixture; no remote writes."""
import json
from browser_test import ARTIFACTS, Browser
from competition_fixture import install, field, enter


def run():
    report = {'checks': [], 'failures': [], 'layouts': []}

    def check(name, passed, detail=None):
        report['checks'].append({'name': name, 'passed': bool(passed), 'detail': detail})
        if not passed:
            report['failures'].append(name)

    browser = Browser(http_port=8769, debug_port=9227)
    browser.profile = ARTIFACTS / 'competition-browser-profile'
    with browser as b:
        install(b)
        b.command('Page.addScriptToEvaluateOnNewDocument', {'source': """
          (() => {let bank;globalThis.__testGenerations=0;
            Object.defineProperty(globalThis,'ProblemBank',{configurable:true,get(){return bank},set(api){
              bank={...api,generateSet(...args){__testGenerations++;const result=api.generateSet(...args);globalThis.__testProblems=result;return result;}};
            }});
          })();
        """})

        def click(action, value=None):
            selector = f'[data-action="{action}"]'
            if value is not None:
                selector += f'[data-value="{value}"]'
            b.click(selector)

        def layout(name):
            result = b.eval("""(() => ({width:innerWidth,height:innerHeight,
              pageWidth:document.documentElement.scrollWidth,
              outside:[...document.querySelectorAll('button,input,select')].filter(el=>{
                const r=el.getBoundingClientRect();return r.width&&r.height&&(r.left<-1||r.right>innerWidth+1);
              }).map(el=>el.outerHTML.slice(0,200))}))()""")
            report['layouts'].append({'name': name, **result})
            check(name, result['pageWidth'] <= result['width'] and not result['outside'], result)

        def answer(index, keyboard=False):
            expected = b.eval(f'__testProblems[{index}].answer')
            field(b, '[name="num"]', expected['n'], 'input')
            field(b, '[name="den"]', expected['d'], 'input')
            if keyboard:
                b.eval("document.querySelector('[name=den]').focus()")
                b.key('Enter')
            else:
                b.click('[type="submit"]')

        def complete(difficulty):
            check('Only registered grade is offered', b.eval("!document.querySelector('[data-action=grade]') && document.querySelector('.choice.active').textContent.includes('4학년')"))
            click('unit', 'g4-addsub')
            click('problem-type', 'proper-add')
            click('count', 5)
            click('difficulty', difficulty)
            before = b.eval('__testGenerations')
            click('start')
            b.wait('#answer-form')
            check(f'{difficulty} starts exactly one problem set', b.eval('__testGenerations') == before + 1)
            check(f'{difficulty} personal has no timer', b.eval("!document.querySelector('[data-timer]')"))
            for index in range(5):
                answer(index, keyboard=True)
                check(f'{difficulty} answer {index} celebrates earned points', b.eval("!!document.querySelector('.score-burst') && document.querySelector('.score-burst strong').textContent.startsWith('+')"))
                if index == 0:
                    check(f'{difficulty} celebration does not intercept clicks', b.eval("getComputedStyle(document.querySelector('.score-burst')).pointerEvents==='none'"))
                    b.screenshot(f'score-answer-{difficulty}.png')
                    text = b.eval("document.querySelector('.session-growth').textContent")
                    b.key('Enter')
                    check(f'{difficulty} Enter cannot award a solved answer twice', b.eval("document.querySelector('.session-growth').textContent") == text)
                click('next')
            b.wait_for("LearningStorage.list()[0]?.classContributionStatus==='synced'")
            check(f'{difficulty} result celebrates the saved total', b.eval("document.querySelector('.score-celebration strong').textContent===LearningStorage.list()[0].score.toLocaleString('ko-KR')+'점'"))
            for width, height in [(1920,1080),(1366,768),(768,1024),(390,844)]:
                b.viewport(width,height)
                layout(f'{difficulty} result reward {width}x{height}')
            b.screenshot(f'score-results-{difficulty}-mobile.png')
            b.command('Emulation.setEmulatedMedia', {'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
            check(f'{difficulty} reduced motion keeps total without animation', b.eval("getComputedStyle(document.querySelector('.score-celebration strong')).animationName==='none'"))
            b.command('Emulation.setEmulatedMedia', {'features':[]})
            b.viewport(1366,768)
            return b.eval('LearningStorage.list()[0]')

        b.navigate()
        b.eval('localStorage.clear();sessionStorage.clear()')
        b.navigate()
        # Old keys are intentionally populated before any new entry. Unknown legacy
        # fields must survive verbatim, even when the removed profile is not displayed.
        legacy = b.eval("""(() => {
          const entries={ [LearningGame.key]:JSON.stringify({version:1,legacySentinel:'old growth'}),
            [ClassRanking.keys.demo]:JSON.stringify({version:1,weeks:{},legacySentinel:'old rankings'}) };
          for(const [key,value] of Object.entries(entries))localStorage.setItem(key,value);
          return entries;
        })()""")
        check('system name is Fraction Trainer', b.eval("document.title.includes('분수트레이너') && document.querySelector('.brand').textContent.includes('분수트레이너')"))
        check('home navigation contains exactly ranking history shortcuts', b.eval("[...document.querySelectorAll('.header-links [data-action]')].map(e=>e.dataset.action).join(',')==='ranking,history,help'"))
        check('home retains only the two requested study modes', b.eval("[...document.querySelectorAll('.mode-card h2')].map(e=>e.textContent).join(',')==='선생님과 함께 수업,전국학급랭킹전'"))
        check('growth and grade description section removed', b.eval("!document.querySelector('[data-action=growth],.curriculum-section') && !document.body.textContent.includes('필요한 배움을 차곡차곡')"))
        for width, height in [(1920, 1080), (1366, 768), (768, 1024), (390, 844)]:
            b.viewport(width, height); layout(f'home {width}x{height}')
        b.viewport(1366, 768)
        click('mode', 'personal')
        check('personal opens school and nickname entry before setup', b.eval("!!document.querySelector('#competition-entry-title') && !document.querySelector('[data-action=start]')"))
        field(b, '#competition-school-query', '서', 'input'); click('competition-search')
        check('school search validates two characters', b.eval("document.querySelector('#competition-search-status').textContent.includes('두 글자')"))
        field(b, '#competition-school-query', '서울', 'input'); click('competition-search')
        b.wait('[data-action=competition-school-pick]')
        click('competition-school-pick', 0)
        field(b, '#competition-grade', 4)
        field(b, '#competition-class', 2)
        click('competition-class-select')
        check('selected school grade and class persist', b.eval("ClassRanking.getSelection().grade===4 && ClassRanking.getSelection().className==='2'"))
        click('competition-roll')
        candidate = b.eval('WeeklyCompetition.getDraft(ClassRanking.getSelection()).selected')
        check('dice creates Korean action plus living nickname', '하는' in candidate)
        check('rolling creates no database entry', b.eval('__competitionFixture.documents.size===0'))
        for _ in range(9):
            click('competition-roll')
        check('ten rolls give ten distinct selectable candidates', b.eval("document.querySelectorAll('[data-action=competition-candidate]').length===10 && WeeklyCompetition.getDraft(ClassRanking.getSelection()).rolls===10"))
        check('eleventh roll is disabled', b.eval("document.querySelector('[data-action=competition-roll]').disabled"))
        check('repository also rejects an eleventh roll', b.eval('!WeeklyCompetition.rollNickname(ClassRanking.getSelection()).ok'))
        for width, height in [(1920, 1080), (1366, 768), (768, 1024), (390, 844)]:
            b.viewport(width, height); layout(f'nickname entry with ten candidates {width}x{height}')
            b.screenshot(f'competition-entry-{width}x{height}.png')
        b.viewport(1366, 768)
        b.navigate(); click('mode', 'personal')
        check('reload preserves ten-roll limit and candidates', b.eval("document.querySelector('[data-action=competition-roll]').disabled && document.querySelectorAll('[data-action=competition-candidate]').length===10"))
        click('competition-candidate', 0)
        b.eval('__competitionFixture.failWrites=true')
        field(b, '#competition-pin', '123456', 'input')
        field(b, '#competition-pin-confirm', '123456', 'input')
        click('competition-confirm')
        b.wait_for("document.querySelector('.competition-entry-message').textContent.includes('등록하지 못')")
        check('failed registration keeps entry available and creates no identity', b.eval("!WeeklyCompetition.getIdentity() && !document.querySelector('[data-action=competition-confirm]').disabled && __competitionFixture.documents.size===0"))
        b.eval('__competitionFixture.failWrites=false')
        click('competition-confirm')
        b.wait_for('!!WeeklyCompetition.getDraft(ClassRanking.getSelection()).confirmed')
        check('confirmation registers player and receipt exactly once', b.eval('__competitionFixture.documents.size===2'))
        check('confirmation fills nickname but does not enter setup', b.eval("document.querySelector('#competition-nickname').value===WeeklyCompetition.getDraft(ClassRanking.getSelection()).confirmed && !WeeklyCompetition.getIdentity()"))
        nickname = b.eval("document.querySelector('#competition-nickname').value")
        repeated = b.eval('WeeklyCompetition.registerNickname(ClassRanking.getSelection(),' + json.dumps(nickname) + ',"123456")')
        check('repeated confirmation retains one database claim', repeated['ok'] and b.eval('__competitionFixture.documents.size===2'))
        field(b, '#competition-nickname', '알수없는이름', 'input'); click('competition-enter')
        b.wait_for("document.querySelector('.competition-entry-message').textContent.includes('정확히')")
        check('unknown nickname cannot enter', b.eval('!WeeklyCompetition.getIdentity()'))
        field(b, '#competition-nickname', nickname, 'input'); click('competition-enter')
        b.wait('.competition-setup')
        identity = b.eval('WeeklyCompetition.getIdentity()')
        check('login binds selected class and nickname', identity['nickname'] == nickname and identity['classroom']['grade'] == 4 and identity['classroom']['className'] == '2')
        check('problem selection uses buttons with no dropdown or inclusion tools', b.eval("document.querySelectorAll('[data-action=problem-type]').length>1 && !document.querySelector('.competition-setup select,.competition-setup input[type=checkbox],#timer-select')"))
        check('student can preview type and difficulty scores', b.eval("document.querySelectorAll('[data-action=difficulty]').length===3 && document.querySelector('[data-action=difficulty][data-value=easy]').textContent.includes('500점') && document.querySelector('[data-action=difficulty][data-value=challenge]').textContent.includes('1500점') && document.querySelector('[data-action=problem-type][data-value=all]').textContent.includes('1000점')"))
        for width, height in [(1920, 1080), (1366, 768), (768, 1024), (390, 844)]:
            b.viewport(width, height); layout(f'competition setup {width}x{height}')
        b.viewport(1366, 768)
        scores = []
        for difficulty in ['easy', 'normal', 'challenge']:
            if scores:
                click('home'); click('mode', 'personal'); enter(b)
            record = complete(difficulty); scores.append(record['score'])
            check(f'{difficulty} saves competition identity and zero XP', record['competition'] == identity and record['expEarned'] == 0 and record['badgesEarned'] == [])
            check(f'{difficulty} class contribution equals personal score', record['classScoreContribution'] == record['score'])
        check('difficulty changes earned scores using existing rules', all(low < score <= high for score, low, high in zip(scores, [1750,2250,2750], [2000,2750,3500])), scores)
        total = sum(scores)
        b.eval("globalThis.__savedRecord=LearningStorage.list()[0]")
        duplicate = b.eval('WeeklyCompetition.submit(__savedRecord)')
        check('duplicate contribution returns receipt and adds no points', duplicate['ok'] and duplicate['duplicate'])
        totals = b.eval("[...__competitionFixture.documents].filter(([key])=>key.includes('weeklyCompetitionClasses_')||key.includes('weeklyCompetitionPlayers_')).map(([,value])=>({score:value.score,sessions:value.sessions}))")
        check('class and individual accumulate exactly the same three sessions', len(totals) == 2 and all(value == {'score': total, 'sessions': 3} for value in totals), totals)
        click('ranking')
        b.wait('.competition-rank-row')
        check('current and previous class boards appear together', b.eval("document.querySelectorAll('.competition-board').length===2 && document.querySelector('#competition-current-title').textContent.includes('실시간') && document.querySelector('#competition-prev-title').textContent.includes('지난주')"))
        check('current class displays accumulated points', b.eval("document.querySelector('.competition-rank-score').textContent") == f'{total:,}점')
        subscriptions = b.eval('__competitionFixture.listeners.size')
        click('competition-kind', 'individual')
        b.wait_for("document.querySelector('.competition-rank-name strong')?.textContent===" + json.dumps(nickname))
        check('individual board uses registered nickname and same points', b.eval("document.querySelector('.competition-rank-score').textContent") == f'{total:,}점')
        check('switching ranking kind cleans previous listeners', 0 < b.eval('__competitionFixture.listeners.size') <= subscriptions)
        for width, height in [(1920, 1080), (1366, 768), (768, 1024), (390, 844)]:
            b.viewport(width, height); layout(f'weekly ranking {width}x{height}')
            b.screenshot(f'competition-ranking-{width}x{height}.png')
        b.viewport(1366, 768)
        b.eval("""(() => {for(const [key,value] of __competitionFixture.documents)if(key.includes('weeklyCompetitionPlayers_'))value.score+=7;__competitionFixture.persist();__competitionFixture.emit();})()""")
        check('realtime snapshot updates displayed individual score', b.eval("document.querySelector('.competition-rank-score').textContent") == f'{total+7:,}점')
        click('home')
        check('leaving rankings unsubscribes all realtime listeners', b.eval('__competitionFixture.listeners.size===0'))
        b.navigate(); click('mode', 'personal')
        check('reload recalls this week nickname', b.eval("document.querySelector('#competition-nickname').value") == nickname)
        enter(b)
        check('reload login retains weekly identity', b.eval('WeeklyCompetition.getIdentity()') == identity)
        for key, value in legacy.items():
            check(f'legacy storage retained: {key}', b.eval('localStorage.getItem(' + json.dumps(key) + ')') == value)
        check('history records survive reload with competition fields', b.eval('LearningStorage.list().length===3 && LearningStorage.list().every(r=>r.competition.playerId===WeeklyCompetition.getIdentity().playerId)'))
        click('competition-change'); click('competition-new-draft')
        check('forgotten nickname opens fresh ten-roll draft while old player stays', b.eval("WeeklyCompetition.getDraft(ClassRanking.getSelection()).rolls===0 && [...__competitionFixture.documents.keys()].some(k=>k.includes('weeklyCompetitionPlayers_'))"))
        # Move the fixture's repository clock across a real Monday 08:00 boundary.
        # Opening the ranking again invokes the actual view's week rollover logic.
        b.eval('__competitionFixture.offset=WeeklyCompetition.getWeek().endMs-Date.now()+1')
        click('home'); click('ranking')
        b.wait_for("document.querySelectorAll('.competition-board').length===2 && !document.body.textContent.includes('랭킹을 불러오고')")
        check('Monday starts an empty current week and displays previous result', b.eval("!document.querySelector('.competition-board:first-child .competition-rank-row') && !!document.querySelector('.competition-board:nth-child(2) .competition-rank-row')"))
        check('new week invalidates previous nickname identity without deleting it', b.eval('WeeklyCompetition.getIdentity()===null && !!WeeklyCompetition.getSavedIdentity()'))
        previous_week = identity['weekId']
        check('weekly reset preserves previous database collections', b.eval("[...__competitionFixture.documents.keys()].some(k=>k.includes(" + json.dumps(previous_week) + '))'))
        click('home'); click('mode', 'personal')
        check('new week provides a fresh draft and expiry explanation', b.eval("WeeklyCompetition.getDraft(ClassRanking.getSelection()).rolls===0 && document.body.textContent.includes('지난주 닉네임')"))
        click('home'); click('ranking'); click('competition-kind', 'class')
        b.wait('.competition-rank-row')
        check('previous class result and new empty class week coexist', b.eval("!document.querySelector('.competition-board:first-child .competition-rank-row') && document.querySelector('.competition-board:nth-child(2) .competition-rank-score').textContent") == f'{total:,}점')
        click('home')
        check('final navigation leaves no realtime listener', b.eval('__competitionFixture.listeners.size===0'))
        b.eval('document.body.offsetHeight')
        remote = [event['params']['request']['url'] for event in b.events
                  if event.get('method') == 'Network.requestWillBeSent'
                  and event['params']['request']['url'].startswith('http')
                  and not event['params']['request']['url'].startswith(b.base_url)]
        check('all competition browser requests stayed local', not remote, remote)
        report['consoleErrors'] = b.console_errors
        check('competition console has zero errors', not b.console_errors, b.console_errors)

    path = ARTIFACTS / 'competition-report.json'
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'checks': len(report['checks']), 'layouts': len(report['layouts']),
                      'failures': report['failures'], 'report': str(path)}, ensure_ascii=False, indent=2))
    if report['failures']:
        raise SystemExit(1)


if __name__ == '__main__':
    run()
