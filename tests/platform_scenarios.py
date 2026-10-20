"""Unified shell/auth/ranking checks, exclusively against local fake Firestore."""
import json
from browser_test import Browser, ARTIFACTS
from competition_fixture import install, field, enter

def run():
    b=Browser(http_port=8776,debug_port=9236)
    b.profile=ARTIFACTS/'platform-profile'
    checks=[]
    with b:
        install(b)
        b.command('Page.addScriptToEvaluateOnNewDocument',{'source':"""for(const name of ['ProblemBank','DecimalTrainer']){let bank;Object.defineProperty(globalThis,name,{configurable:true,get:()=>bank,set:api=>{bank={...api,generateSet(...args){const ps=api.generateSet(...args);globalThis.__problems=ps;return ps;}};}});}"""})
        b.navigate('/index.html')
        b.eval('localStorage.clear();sessionStorage.clear()')
        b.navigate('/index.html')
        def click(a,v=None): b.click('[data-action="'+a+'"]'+('' if v is None else '[data-value="'+str(v)+'"]'))
        def check(name,expression):
            assert b.eval(expression),name
            checks.append(name)
        click('trainer','fraction');click('mode','personal');enter(b)
        identity=b.eval('WeeklyCompetition.getIdentity().playerId')
        click('problem-type','proper-add');click('count',5);click('start')
        for i in range(5):
            p=b.eval('__problems['+str(i)+']')
            field(b,'[name=num]',p['answer']['n'],'input');field(b,'[name=den]',p['answer']['d'],'input');b.click('[type=submit]');click('next')
        b.wait_for("LearningStorage.list()[0]?.classContributionStatus==='synced'")
        fraction=b.eval('JSON.stringify(LearningStorage.list())')
        click('platform-home');click('trainer','decimal');click('mode','personal')
        check('Same authenticated student without reentry','WeeklyCompetition.getIdentity().playerId==='+json.dumps(identity)+' && !!document.querySelector(".competition-setup")')
        click('unit','decimal-addition');click('problem-type','D4-A2');click('count',5);click('start')
        check('Decimal uses same study card','!!document.querySelector(".study-card") && !!document.querySelector(".session-growth")')
        for i in range(5):
            answer=b.eval('__problems['+str(i)+'].answer')
            field(b,'[name=value]',answer,'input');b.click('[type=submit]');b.key('Enter');click('next')
        b.wait_for("TrainerAdapters.decimal.store.list()[0]?.classContributionStatus==='synced'")
        check('Fraction history unchanged','JSON.stringify(LearningStorage.list())==='+json.dumps(fraction))
        check('Decimal record domain isolated',"TrainerAdapters.decimal.store.list()[0].trainerId==='decimal'")
        click('ranking');click('ranking-trainer','fraction');click('ranking-trainer','decimal')
        check('Shared ranking tabs','document.querySelectorAll("[data-action=ranking-trainer]").length===2')
        click('platform-home');click('trainer','fraction');click('mode','personal')
        check('Returning to fraction retains identity','WeeklyCompetition.getIdentity().playerId==='+json.dumps(identity))
        for trainer in ['fraction','decimal']:
            click('platform-home');click('trainer',trainer);click('mode','classroom');click('start')
            for width,height in [(1920,1080),(1366,768),(1024,768),(768,1024),(360,800)]:
                b.viewport(width,height)
                check(trainer+' no horizontal overflow '+str(width),'document.documentElement.scrollWidth<=innerWidth')
                if width==1920:check(trainer+' FHD no vertical scroll','document.documentElement.scrollHeight<=innerHeight')
            b.viewport(1920,1080)
            for action in ['hint','answer','solution','next','previous']:
                click(action)
                check(trainer+' FHD '+action,'document.documentElement.scrollHeight<=innerHeight')
            b.screenshot('platform-'+trainer+'-board.png')
            click('finish')
        click('platform-home');click('platform-logout')
        check('Logout is common','!WeeklyCompetition.getIdentity()')
        click('platform-login');field(b,'#competition-pin','123456','input');click('competition-enter')
        b.wait('[data-action="trainer"]')
        check('Platform login returns to platform home','WeeklyCompetition.getIdentity().playerId==='+json.dumps(identity))
        assert not b.console_errors,b.console_errors
        checks.append('No browser console errors')
    (ARTIFACTS/'platform-report.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf8')
    print('PASS',len(checks),'platform checks')
if __name__=='__main__':run()
