"""Real Firestore emulator integration. Never connects to the production database.

Uses the emulator JAR, Java 21 and Firebase 8.10.1 test SDK under
tests/artifacts/firestore-tools (not application dependencies).
"""
import json
import os
import socket
import subprocess
import time
from browser_test import Browser, ARTIFACTS, WORKSPACE

def run():
    tools = ARTIFACTS / 'firestore-tools'
    java = next(tools.glob('**/bin/java.exe'))
    with socket.socket() as probe:
        assert probe.connect_ex(('127.0.0.1',8780)) != 0, 'Emulator port already in use'
    log = (ARTIFACTS / 'firestore-rules.log').open('w', encoding='utf8')
    process = subprocess.Popen([str(java), '-Duser.language=en', '-Duser.country=US', '-jar', str(tools/'firestore.jar'),
        '--host','127.0.0.1','--port','8780','--project_id','demo-math-trainer',
        '--rules',str(WORKSPACE/'firestore.rules')], stdout=log, stderr=log,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    try:
        for _ in range(150):
            assert process.poll() is None, 'Emulator exited; inspect firestore-rules.log'
            with socket.socket() as probe:
                if probe.connect_ex(('127.0.0.1',8780))==0: break
            time.sleep(.1)
        b=Browser(http_port=8779,debug_port=9239); b.profile=ARTIFACTS/'rules-browser-profile'
        with b:
            b.navigate('/index.html')
            result=b.eval("""(async()=>{
              for(const file of ['firebase-app.js','firebase-firestore.js']) await new Promise((resolve,reject)=>{
                const s=document.createElement('script');s.src='/tests/artifacts/firestore-tools/'+file;s.onload=resolve;s.onerror=reject;document.head.append(s);
              });
              const db=firebase.initializeApp({projectId:'demo-math-trainer',apiKey:'emulator-only'},'rules-test').firestore();
              db.useEmulator('127.0.0.1',8780); firebase.firestore.setLogLevel('silent');
              const provider=WeeklyCompetition.createFirestoreProvider(db);
              const repo=WeeklyCompetition.createRepository({storage:null,onlineProvider:provider,timeoutMs:15000});
              const checks=[];
              function check(ok,label){if(!ok)throw Error(label);checks.push(label);}
              const classroom={schoolName:'규칙검증초등학교',region:'테스트',grade:4,className:'1'};
              const nickname=repo.rollNickname(classroom).draft.selected;
              const registered=await repo.registerNickname(classroom,nickname,'123456');check(registered.ok,'fraction registration: '+registered.message);
              const login=await repo.login(classroom,nickname,'123456');check(login.ok,'shared login');
              const identity=login.identity,week=identity.weekId;
              const record={id:'rules-session',competition:identity,completed:true,rankingEnabled:true,date:new Date().toISOString(),
                score:65,total:5,correct:5,firstCorrect:5,settings:{difficulty:'normal'}};
              for(const trainerId of ['fraction','decimal']){
                const prefix=trainerId==='decimal'?'decimalWeekly':'weekly';
                const row={...record,trainerId};
                for(const id of ['rules-session','rules-session-2']){
                  const result=await repo.submit({...row,id});check(result.ok,trainerId+' contributes '+id+': '+result.message);
                }
                const duplicate=await repo.submit(row);check(duplicate.ok&&duplicate.duplicate,trainerId+' duplicate receipt');
                for(const [kind,key] of [['Classes',identity.classroom.id],['Players',identity.playerId]]){
                  const collection=db.collection(prefix+'Competition'+kind+'_'+week);
                  const value=(await collection.doc(key).get()).data();check(value.score===130&&value.sessions===2,trainerId+' '+kind+' exact score');
                  const result=await collection.orderBy('score','desc').get();check(result.size===1,trainerId+' '+kind+' ranking query');
                }
              }
              async function denied(action,label){try{await action();throw Error('Unexpected allow: '+label);}catch(e){check(e.code==='permission-denied',label);}}
              const player=db.collection('weeklyCompetitionPlayers_'+week).doc(identity.playerId);
              await denied(()=>player.update({trainerId:'fraction',score:195,sessions:3,totalSolved:15,correctCount:15}),'existing metadata protected (original failure)');
              const decimal=db.collection('decimalWeeklyCompetitionPlayers_'+week).doc(identity.playerId);
              await denied(()=>decimal.update({nickname:'변경'}),'nickname immutable');
              await denied(()=>decimal.update({score:99999999,sessions:3,totalSolved:15,correctCount:15}),'score cap enforced');
              await denied(()=>decimal.delete(),'deletion denied');
              const receipts=db.collection('decimalWeeklyCompetitionReceipts_'+week);
              await denied(()=>receipts.get(),'receipt listing denied');
              await denied(()=>receipts.doc('session-rules-session').update({score:0}),'receipt immutable');
              const value=(await decimal.get()).data();
              await denied(()=>db.collection('decimalWeeklyCompetitionPlayers_'+week).doc('unregistered').set({...value,playerId:'unregistered',platformPlayerId:'unregistered',score:65,sessions:1,totalSolved:5,correctCount:5}),'unregistered decimal identity denied');
              await denied(()=>db.collection('classRankings_'+week).doc('test').set({score:1}),'legacy remains read-only');
              await db.terminate();return checks;
            })()""")
            assert not b.console_errors,b.console_errors
            (ARTIFACTS/'firestore-rules-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
            print('PASS',len(result),'real Firestore emulator checks')
    finally:
        process.terminate();process.wait(timeout=15);log.close()

if __name__=='__main__':run()
