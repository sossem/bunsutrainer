"""PIN, grade restriction, touch ink and viewport checks with a local database only."""
import json
from browser_test import Browser, ARTIFACTS
from competition_fixture import install, enter, field


def run():
    report = {'checks': [], 'failures': []}

    def check(name, passed):
        report['checks'].append({'name': name, 'passed': bool(passed)})
        if not passed:
            report['failures'].append(name)

    browser = Browser(http_port=8770, debug_port=9228)
    browser.profile = ARTIFACTS / 'requested-changes-profile'
    with browser as b:
        install(b)
        b.command('Page.addScriptToEvaluateOnNewDocument', {'source': """
          (()=>{let pad;Object.defineProperty(globalThis,'Scratchpad',{configurable:true,
            get:()=>pad,set:api=>{pad={mount(s){globalThis.__session=s;api.mount(s);}}}});})();
        """})
        b.navigate()
        b.eval('localStorage.clear(); sessionStorage.clear()')
        b.navigate()
        b.click('[data-action="mode"][data-value="personal"]')
        enter(b)
        check('Only class grade shown', b.eval("!document.querySelector('[data-action=grade]') && document.querySelector('.choice.active').textContent.includes('4학년')"))
        check('Wrong PIN denied', b.eval("(async()=>{const i=WeeklyCompetition.getIdentity();globalThis.__identity=i;return !(await WeeklyCompetition.login(i.classroom,i.nickname,'000000')).ok;})()"))
        check('Correct PIN works', b.eval("(async()=>{const i=__identity;return (await WeeklyCompetition.login(i.classroom,i.nickname,'123456')).ok;})()"))
        check('PIN absent from browser storage', b.eval("!Object.values(localStorage).some(s=>s.includes('123456'))"))
        b.click('[data-action="start"]')

        def ink_count():
            return b.eval('Object.values(__session.ink).reduce((n,s)=>n+s.length,0)')

        def draw(touch=False):
            r = b.eval("(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x+30,y:r.y+30};})()")
            if touch:
                b.command('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[r]})
                b.command('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':r['x']+60,'y':r['y']+40}]})
                b.command('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
            else:
                b.command('Input.dispatchMouseEvent', {'type':'mousePressed','button':'left','clickCount':1,**r})
                b.command('Input.dispatchMouseEvent', {'type':'mouseMoved','button':'left','buttons':1,'x':r['x']+60,'y':r['y']+40})
                b.command('Input.dispatchMouseEvent', {'type':'mouseReleased','button':'left','clickCount':1,'x':r['x']+60,'y':r['y']+40})

        for mode in ['personal', 'classroom']:
            if mode == 'classroom':
                b.navigate()
                b.click('[data-action="mode"][data-value="classroom"]')
                b.click('[data-action="grade"][data-value="5"]')
                b.click('[data-action="unit"][data-value="g5-addsub"]')
                field(b, '#type-select', 'borrow')
                b.click('[data-action="difficulty"][data-value="challenge"]')
                b.click('[data-action="start"]')
            check(mode+' starts collapsed', b.eval("document.querySelector('.scratch-toggle').getAttribute('aria-expanded')==='false'"))
            b.click('.scratch-toggle')
            b.eval("document.querySelector('.scratch-toggle').focus()")
            b.key('Space')
            check(mode+' keyboard folds pad without revealing answer', b.eval("!__session.inkOpen && !__session.reveals[__session.index].answerShown"))
            b.key('Space')
            draw()
            check(mode+' mouse ink', ink_count() == 1)
            b.click('.scratch-toggle'); b.click('.scratch-toggle')
            check(mode+' collapse retains ink', ink_count() == 1)
            for width, height in [(1920,1080),(1366,768),(768,1024),(390,844)]:
                b.viewport(width,height)
                check(f'{mode} {width} no horizontal overflow', b.eval('document.documentElement.scrollWidth<=innerWidth'))
                check(f'{mode} {width} positive canvas size', b.eval("document.querySelector('canvas').getBoundingClientRect().height>50"))
                if mode == 'classroom':
                    check(f'classroom {width} no page scroll', b.eval('document.documentElement.scrollHeight<=innerHeight'))
                b.screenshot(f'{mode}-scratch-{width}.png')
            b.viewport(1920,1080)
            draw(touch=True)
            check(mode+' touch ink', ink_count() == 2)
            b.click('[data-ink="eraser"]'); draw()
            check(mode+' eraser tool', b.eval("__session.ink[__session.problems[__session.index].id].at(-1).erase"))
            b.click('[data-ink="undo"]')
            b.click('[data-action="hint"]')
            check(mode+' rerender retains ink', ink_count() == 2)
            b.click('[data-ink="undo"]')
            check(mode+' undo', ink_count() == 1)
            if mode == 'classroom':
                b.key('ArrowRight')
                check('Next question has its own sheet', b.eval('!__session.ink[__session.problems[__session.index].id].length'))
                b.key('ArrowLeft')
                check('Previous question restores sheet', b.eval('__session.ink[__session.problems[__session.index].id].length===1'))
                for action in ['answer','solution','visual']:
                    b.click(f'[data-action="{action}"]')
                    check(action+' with ink fits FHD', b.eval("(()=>{const s=document.querySelector('.classroom-stage').getBoundingClientRect();return [...document.querySelectorAll('.classroom-stage .math-line')].every(e=>{const r=e.getBoundingClientRect();return r.left>=s.left-2&&r.right<=s.right+2&&r.bottom<=s.bottom+2;});})()"))
                b.key('f')
                check('Fullscreen keeps ink', b.eval('!!document.fullscreenElement && Object.values(__session.ink).some(s=>s.length)'))
                b.eval('document.exitFullscreen()')
            b.click('[data-ink="clear"]')
            check(mode+' clear current sheet', ink_count() == 0)
        for grade, unit, kind in [(4,'g4-addsub','whole-minus-mixed'), (5,'g5-equivalence','common'), (5,'g5-multiply','mixed-multiply'), (6,'g6-divide','mixed-divide')]:
            b.navigate()
            b.click('[data-action="mode"][data-value="classroom"]')
            b.click(f'[data-action="grade"][data-value="{grade}"]')
            b.click(f'[data-action="unit"][data-value="{unit}"]')
            field(b, '#type-select', kind)
            b.click('[data-action="difficulty"][data-value="challenge"]')
            b.click('[data-action="start"]'); b.click('.scratch-toggle')
            b.click('[data-action="answer"]'); b.click('[data-action="solution"]')
            for width,height in [(1920,1080),(1366,768)]:
                b.viewport(width,height)
                steps = b.eval('__session.problems[0].steps.length')
                for step in range(steps):
                    check(f'{kind} {width} solution step {step} fits beside ink', b.eval("(()=>{const s=document.querySelector('.classroom-stage').getBoundingClientRect();return [...document.querySelectorAll('.classroom-stage .math-line, .classroom-stage .fraction')].every(e=>{const r=e.getBoundingClientRect();return r.left>=s.left-2&&r.right<=s.right+2&&r.bottom<=s.bottom+2;});})()"))
                    next_button = b.eval("!!document.querySelector('[data-action=step-next]:not(:disabled)')")
                    if next_button:
                        b.click('[data-action="step-next"]')
                for _ in range(steps-1):
                    b.click('[data-action="step-prev"]')
        check('No browser console errors', not b.console_errors)
        report['consoleErrors'] = b.console_errors
    ARTIFACTS.mkdir(exist_ok=True)
    (ARTIFACTS/'requested-changes.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'checks':len(report['checks']),'failures':report['failures']},ensure_ascii=False))
    if report['failures']:
        raise SystemExit(1)


if __name__ == '__main__':
    run()
