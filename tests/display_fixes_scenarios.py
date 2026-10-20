"""Check actual cell geometry, bundled fonts and account alignment in Chrome."""
from browser_test import Browser, ARTIFACTS
from competition_fixture import install, enter

def run():
    b = Browser(http_port=8778, debug_port=9238)
    b.profile = ARTIFACTS / 'display-fixes-profile'
    checks = 0
    with b:
        install(b)
        b.navigate('/index.html')
        b.eval('localStorage.clear(); sessionStorage.clear()')
        b.navigate('/index.html')
        b.eval('document.fonts.ready')
        assert b.eval("document.fonts.check('16px GangwonEduPower') && document.fonts.check('16px \"GangwonEduAll Light\"')")
        assert b.eval("getComputedStyle(document.querySelector('h1')).fontFamily.startsWith('GangwonEduPower')")
        assert b.eval("getComputedStyle(document.body).fontFamily.includes('GangwonEduAll Light')")
        assert b.eval("document.querySelectorAll('.mode-card').length === 2 && !document.querySelector('.future-card')")
        b.click('[data-action=trainer][data-value=fraction]')
        b.click('[data-action=mode][data-value=personal]'); enter(b)
        b.click('[data-action=platform-home]')
        for w,h in [(1920,1080),(1366,768),(768,1024),(360,800)]:
            b.viewport(w,h)
            assert b.eval('document.documentElement.scrollWidth <= innerWidth')
            assert b.eval("Math.abs(document.querySelector('.platform-account-info strong').getBoundingClientRect().left - document.querySelector('.platform-account-info p').getBoundingClientRect().left) < 1")
            checks += 2
        b.viewport(1920,1080); b.screenshot('display-account-fhd.png')
        b.click('[data-action=trainer][data-value=decimal]')
        b.click('[data-action=mode][data-value=classroom]')
        for count in [1,9,10,37,90,99]:
            b.eval(f"DecimalTrainer.generateSet=()=>[{{...DecimalTrainer.generate('D3-01',17),model:{{kind:'grid',count:{count}}}}}]")
            b.click('[data-action=start]')
            for action in [None,'hint','answer','solution']:
                if action: b.click('[data-action='+action+']')
                for w,h in [(1920,1080),(1366,768),(768,1024),(360,800)]:
                    b.viewport(w,h)
                    assert b.eval("""(()=>{
                      const grid=document.querySelector('.decimal-grid'), box=grid.getBoundingClientRect();
                      const cells=[...grid.children].map(e=>e.getBoundingClientRect());
                      return cells.length===100 && cells.every(c=>Math.abs(c.width-box.width/10)<.1 && Math.abs(c.height-box.height/10)<.1);
                    })()"""), (count, action, w)
                    assert b.eval('document.documentElement.scrollWidth <= innerWidth')
                    if w==1920: assert b.eval('document.documentElement.scrollHeight <= innerHeight')
                    checks += 1
            b.viewport(1920,1080)
            if count==37: b.screenshot('display-decimal-grid-fhd.png')
            assert b.eval("getComputedStyle(document.querySelector('.problem-equation')).fontFamily.startsWith('Pretendard')")
            b.click('[data-action=settings]')
        assert not b.console_errors, b.console_errors
    print('PASS',checks,'display geometry/layout checks; bundled fonts loaded; no console errors')

if __name__=='__main__': run()
