"""Class-document contention load test on the Firestore emulator. Never touches production.

Many students of one class submit at the same moment, each with its own Firestore
client (separate firebase app), the production 8-second timeout and optional
Chrome network latency. Reports ok / pending / failed per scenario and whether the
class totals match the receipts. Read-only with respect to application code.

Under the deployed HEAD code a client timeout is reported as 'failed', so every
'pending' here would have been a failed (missed) contribution in production.
"""
import json
import os
import socket
import subprocess
import sys
import time
from browser_test import Browser, ARTIFACTS, WORKSPACE

PORT = 8782
SCENARIOS = [  # (students, latency ms, class doc already exists this week)
    (10, 0, False), (25, 0, False), (30, 0, False),
    (10, 150, False), (25, 150, False), (30, 150, False), (30, 400, False),
    (10, 150, True), (25, 150, True), (30, 150, True), (30, 400, True),
]

SCRIPT = r"""(async(students,latencyLabel,tag)=>{
  const classroom={schoolName:'부하검증초등학교'+tag,region:'테스트',grade:4,className:'1'};
  const members=[];
  for(let i=0;i<students;i++){
    const db=firebase.initializeApp({projectId:'demo-math-trainer',apiKey:'emulator-only'},'load-'+tag+'-'+i).firestore();
    db.useEmulator('127.0.0.'+(2+i),%PORT%); // distinct host per student: avoids Chrome's 6-connections-per-host cap
    const provider=WeeklyCompetition.createFirestoreProvider(db);
    const seed=(i+1)/(students+2);
    const repo=WeeklyCompetition.createRepository({storage:null,onlineProvider:provider,timeoutMs:8000,random:()=>seed});
    const nick=repo.rollNickname(classroom).draft.selected;
    const reg=await repo.registerNickname(classroom,nick,'123456');
    if(!reg.ok)throw Error('register '+i+': '+reg.message);
    const login=await repo.login(classroom,nick,'123456');
    if(!login.ok)throw Error('login '+i+': '+login.message);
    members.push({db,repo,identity:login.identity});
  }
  return members.length;
})"""

SUBMIT = r"""(async(tag)=>{
  const members=window.__members[tag];
  const started=performance.now();
  const outcomes=await Promise.all(members.map(async({repo,identity},i)=>{
    const t=performance.now();
    const record={id:'load-'+tag+'-'+i,competition:identity,completed:true,rankingEnabled:true,trainerId:'fraction',
      date:new Date().toISOString(),score:65,total:5,correct:5,firstCorrect:5,settings:{difficulty:'normal'}};
    const r=await repo.submit(record);
    const out={i,ok:r.ok,pending:!!r.pending,code:r.code||null,ms:Math.round(performance.now()-t),message:r.message};
    if(r.pending&&r.completion){
      const late=await Promise.race([r.completion,new Promise(res=>setTimeout(()=>res({ok:false,code:'never-settled-60s'}),60000))]);
      out.late={ok:late.ok,code:late.code||null,ms:Math.round(performance.now()-t)};
    }
    return out;
  }));
  const {db,identity}=members[0];
  const week=identity.weekId;
  const cls=(await db.collection('weeklyCompetitionClasses_'+week).doc(identity.classroom.id).get({source:'server'})).data()||{score:0,sessions:0};
  let receipts=0;
  for(let i=0;i<members.length;i++){
    const s=await db.collection('weeklyCompetitionReceipts_'+week).doc('session-'+encodeURIComponent('load-'+tag+'-'+i)).get({source:'server'});
    if(s.exists)receipts++;
  }
  return {outcomes,classSessions:cls.sessions,classScore:cls.score,receipts,totalMs:Math.round(performance.now()-started)};
})"""


def run():
    tools = ARTIFACTS / 'firestore-tools'
    java = next(tools.glob('**/bin/java.exe'))
    with socket.socket() as probe:
        assert probe.connect_ex(('127.0.0.1', PORT)) != 0, 'Emulator port already in use'
    log = (ARTIFACTS / 'firestore-load.log').open('w', encoding='utf8')
    process = subprocess.Popen([str(java), '-Duser.language=en', '-Duser.country=US', '-jar', str(tools / 'firestore.jar'),
        '--host', '0.0.0.0', '--port', str(PORT), '--project_id', 'demo-math-trainer',
        '--rules', str(WORKSPACE / 'firestore.rules')], stdout=log, stderr=log,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    report = []
    try:
        for _ in range(150):
            assert process.poll() is None, 'Emulator exited; inspect firestore-load.log'
            with socket.socket() as probe:
                if probe.connect_ex(('127.0.0.1', PORT)) == 0: break
            time.sleep(.1)
        b = Browser(http_port=8781, debug_port=9241); b.profile = ARTIFACTS / 'load-browser-profile'
        with b:
            b.navigate('/index.html')
            b.ws.settimeout(600)
            b.eval("""(async()=>{
              for(const file of ['firebase-app.js','firebase-firestore.js']) await new Promise((resolve,reject)=>{
                const s=document.createElement('script');s.src='/tests/artifacts/firestore-tools/'+file;s.onload=resolve;s.onerror=reject;document.head.append(s);
              });
              firebase.firestore.setLogLevel('silent');window.__members={};return true;
            })()""")
            b.command('Network.enable')
            for n, (students, latency, warm) in enumerate(SCENARIOS):
                tag = f's{n}'
                b.command('Network.emulateNetworkConditions', {'offline': False, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1})
                setup = SCRIPT.replace('%PORT%', str(PORT)).replace('return members.length;', 'window.__members[tag]=members;return members.length;')
                b.eval(f"({setup})({students},'{latency}','{tag}r')")
                if warm:  # one earlier contribution so the class document exists before the burst
                    b.eval(f"""(async()=>{{const m=window.__members['{tag}r'][0];
                      const r=await m.repo.submit({{id:'warm-{tag}',competition:m.identity,completed:true,rankingEnabled:true,trainerId:'fraction',
                        date:new Date().toISOString(),score:65,total:5,correct:5,firstCorrect:5,settings:{{difficulty:'normal'}}}});
                      if(!r.ok)throw Error('warm: '+r.message);return true;}})()""")
                b.command('Network.emulateNetworkConditions', {'offline': False, 'latency': latency, 'downloadThroughput': -1, 'uploadThroughput': -1})
                result = b.eval(f"({SUBMIT})('{tag}r')")
                window_cleanup(b, f'{tag}r')
                outs = result['outcomes']
                row = {
                    'students': students, 'latencyMs': latency,
                    'ok': sum(o['ok'] for o in outs),
                    'pending': sum(o['pending'] for o in outs),
                    'failed': sum((not o['ok']) and (not o['pending']) for o in outs),
                    'pendingLaterOk': sum(1 for o in outs if o.get('late', {}).get('ok')),
                    'failCodes': sorted({o['code'] for o in outs if not o['ok'] and o['code']}),
                    'maxMs': max(o['ms'] for o in outs),
                    'receipts': result['receipts'], 'classSessions': result['classSessions'],
                    'warm': warm,
                    'consistent': result['receipts'] + warm == result['classSessions'] and result['classScore'] == 65 * result['classSessions'],
                    'outcomes': outs,
                }
                report.append(row)
                print(f"{'기존문서' if warm else '첫생성'} {students:>3}명 지연{latency:>4}ms | 즉시성공 {row['ok']:>2} 확인중 {row['pending']:>2} (나중성공 {row['pendingLaterOk']:>2}) 실패 {row['failed']:>2} "
                      f"| 영수증 {row['receipts']:>2}/학급 sessions {row['classSessions']:>2} 일치={row['consistent']} | 최대 {row['maxMs']}ms {row['failCodes']}", flush=True)
            unexpected = [e for e in b.console_errors if '403' in e.get('text', '')]
            (ARTIFACTS / 'class-contention-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
            print('permission-denied network errors:', len(unexpected))
    finally:
        process.terminate(); process.wait(timeout=15); log.close()


def window_cleanup(b, tag):
    b.eval(f"""(async()=>{{for(const m of window.__members['{tag}']||[])await m.db.terminate();delete window.__members['{tag}'];return true;}})()""")


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    run()
