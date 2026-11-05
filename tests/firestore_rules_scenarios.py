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
        '--host','0.0.0.0','--port','8780','--project_id','demo-math-trainer',
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
            b.ws.settimeout(90)
            result=b.eval("""(async()=>{
              for(const file of ['firebase-app.js','firebase-firestore.js']) await new Promise((resolve,reject)=>{
                const s=document.createElement('script');s.src='/tests/artifacts/firestore-tools/'+file;s.onload=resolve;s.onerror=reject;document.head.append(s);
              });
              const db=firebase.initializeApp({projectId:'demo-math-trainer',apiKey:'emulator-only'},'rules-test').firestore();
              db.useEmulator('127.0.0.1',8780); firebase.firestore.setLogLevel('silent');
              const provider=WeeklyCompetition.createFirestoreProvider(db);
              const repo=WeeklyCompetition.createRepository({storage:null,onlineProvider:provider,timeoutMs:15000,random:()=>0});
              const checks=[];
              function check(ok,label){if(!ok)throw Error(label);checks.push(label);}
              const classroom={schoolName:'규칙검증초등학교',region:'테스트',grade:4,className:'1'};
              const nickname=repo.rollNickname(classroom).draft.selected;
              const registered=await repo.registerNickname(classroom,nickname,'123456');check(registered.ok,'fraction registration: '+registered.message);
              const login=await repo.login(classroom,nickname,'123456');check(login.ok,'shared login');
              const identity=login.identity,week=identity.weekId;
              check((await db.collection('weeklyCompetitionPlayers_'+week).doc(identity.playerId).get()).data().pinCredential.hash.length===64,'PIN stored only as a salted hash');
              check(!(await repo.login(classroom,nickname,'000000')).ok,'wrong PIN rejected');
              check((await repo.login(classroom,nickname,'123456')).ok,'login again');
              const mine=db;
              let dup=null;try{await provider.register({identity,draftId:'other-draft',pin:'123456'});}catch(e){dup=e;}
              check(dup&&/이미 사용 중/.test(dup.message),'same nickname cannot be registered twice this week');
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
              // Score forgery: class/player score changes must match a receipt created in the same batch.
              const inc=firebase.firestore.FieldValue.increment;
              await denied(()=>db.collection('weeklyCompetitionPlayers_'+week).doc(identity.playerId).set({...identity,pinCredential:{salt:'x',hash:'y'},score:0,sessions:0,totalSolved:0,correctCount:0}),'overwriting a registered nickname denied');
              await denied(()=>db.collection('weeklyCompetitionReceipts_'+week).doc('nickname-squat').set({kind:'nickname',identity,draftId:'squat'}),'nickname claim without a new player denied');
              const forgeClass=mine.collection('weeklyCompetitionClasses_'+week).doc(identity.classroom.id);
              const forgePlayer=mine.collection('weeklyCompetitionPlayers_'+week).doc(identity.playerId);
              const forgeReceipts=mine.collection('weeklyCompetitionReceipts_'+week);
              const bump=(score,key)=>({score:inc(score),sessions:inc(1),totalSolved:inc(5),correctCount:inc(5),lastSession:key});
              await denied(()=>forgeClass.set(bump(65,'none'),{merge:true}),'class increment without receipt denied');
              await denied(()=>{const b=mine.batch();
                b.set(forgeClass,bump(9999,'forge-1'),{merge:true});b.set(forgePlayer,bump(65,'forge-1'),{merge:true});
                b.set(forgeReceipts.doc('session-forge-1'),{kind:'session',key:'forge-1',playerId:identity.playerId,classId:identity.classroom.id,weekId:week,score:65,total:5,firstCorrect:5});
                return b.commit();},'class increment larger than receipt denied');
              await denied(()=>{const b=mine.batch();
                b.set(forgeClass,bump(65,'forge-2'),{merge:true});
                b.set(forgeReceipts.doc('session-forge-2'),{kind:'session',key:'forge-2',playerId:identity.playerId,classId:identity.classroom.id,weekId:week,score:65,total:5,firstCorrect:5});
                return b.commit();},'receipt without player increment denied');
              await denied(()=>{const b=mine.batch();
                b.set(forgeClass,bump(65,'rules-session'),{merge:true});b.set(forgePlayer,bump(65,'rules-session'),{merge:true});
                b.set(forgeReceipts.doc('session-rules-session'),{kind:'session',key:'rules-session',playerId:identity.playerId,classId:identity.classroom.id,weekId:week,score:65,total:5,firstCorrect:5});
                return b.commit();},'replaying an existing receipt denied');
              // Real transaction contention: different students update the same class concurrently.
              const classmates=[];
              for(const random of [()=>.25,()=>.5]){
                const member=WeeklyCompetition.createRepository({storage:null,onlineProvider:WeeklyCompetition.createFirestoreProvider(db),timeoutMs:15000,random});
                const nick=member.rollNickname(classroom).draft.selected;
                check((await member.registerNickname(classroom,nick,'123456')).ok,'classmate registration');
                const joined=await member.login(classroom,nick,'123456');check(joined.ok,'classmate login');
                classmates.push({member,identity:joined.identity});
              }
              for(const trainerId of ['fraction','decimal']){
                const prefix=trainerId==='decimal'?'decimalWeekly':'weekly';
                const classRef=db.collection(prefix+'CompetitionClasses_'+week).doc(identity.classroom.id);
                const before=(await classRef.get()).data();
                const outcomes=await Promise.all(classmates.flatMap(({member,identity},i)=>[0,1].map(n=>member.submit({...record,trainerId,competition:identity,id:'parallel-'+i+'-'+n}))));
                check(outcomes.every(x=>x.ok),trainerId+' concurrent students and sessions');
                const after=(await classRef.get()).data();
                check(after.score===before.score+260&&after.sessions===before.sessions+4,trainerId+' no lost concurrent class totals');

                // Commit succeeds but its response never reaches the application.
                const delayed={...provider,async contribute(payload){await provider.contribute(payload);return new Promise(()=>{});}};
                const recovering=WeeklyCompetition.createRepository({storage:null,onlineProvider:delayed,timeoutMs:1000});
                check((await recovering.login(classroom,nickname,'123456')).ok,'recovery login');
                const recovered=await recovering.submit({...record,trainerId,id:'lost-response'});
                check(recovered.ok&&recovered.duplicate,trainerId+' server receipt recovers lost response');

                // No commit yet: stay pending, share the existing request, then settle once.
                let release,calls=0;
                const gate=new Promise(resolve=>{release=resolve;});
                const slow={...provider,async contribute(payload){calls++;await gate;return provider.contribute(payload);}};
                const pendingRepo=WeeklyCompetition.createRepository({storage:null,onlineProvider:slow,timeoutMs:1000});
                check((await pendingRepo.login(classroom,nickname,'123456')).ok,'pending login');
                const session={...record,trainerId,id:'pending-response'};
                const pending=await pendingRepo.submit(session);
                check(!pending.ok&&pending.pending,trainerId+' absent receipt is not success');
                const retry=pendingRepo.submit(session);release();
                check((await pending.completion).ok&&(await retry).ok&&calls===1,trainerId+' late success without parallel resubmission');
                check((await repo.submit(session)).duplicate,trainerId+' reload retry uses receipt');
                const end=(await classRef.get()).data();
                check(end.score===after.score+130&&end.sessions===after.sessions+2,trainerId+' recovery awards exactly once');

                // Seed legacy/corrupt fixtures using the emulator-only admin endpoint.
                const playerRef=db.collection(prefix+'CompetitionPlayers_'+week).doc(identity.playerId);
                async function adminFields(ref,change){
                  const url='http://127.0.0.1:8780/v1/projects/demo-math-trainer/databases/(default)/documents/'+ref.path.split('/').map(encodeURIComponent).join('/');
                  const headers={Authorization:'Bearer owner','Content-Type':'application/json'};
                  const read=await fetch(url,{headers});check(read.ok,'emulator fixture read');
                  const document=await read.json();change(document.fields);
                  const write=await fetch(url,{method:'PATCH',headers,body:JSON.stringify({fields:document.fields})});
                  check(write.ok,'emulator fixture write');
                }
                await adminFields(playerRef,fields=>{
                  fields.scoreVersion={integerValue:'2'};delete fields.trainerId;
                });
                await adminFields(classRef,fields=>{fields.scoreVersion={integerValue:'2'};delete fields.trainerId;});
                check((await repo.submit({...record,trainerId,id:'legacy-v2'})).ok,trainerId+' legacy v2 without trainer metadata');
                const legacy=(await playerRef.get()).data();
                check(legacy.scoreVersion===4&&!Object.hasOwn(legacy,'trainerId'),trainerId+' legacy metadata preserved');
                const beforeCorrupt=(await classRef.get()).data();
                await adminFields(classRef,fields=>{delete fields.totalSolved;});
                const invalid=await repo.submit({...record,trainerId,id:'missing-counter'});
                check(!invalid.ok&&invalid.code==='permission-denied',trainerId+' unsupported missing counters rejected');
                check((await playerRef.get()).data().score===legacy.score,trainerId+' rejected class update is atomic');
                await adminFields(classRef,fields=>{fields.totalSolved={integerValue:String(beforeCorrupt.totalSolved)};});
                check((await repo.submit({...record,trainerId,id:'missing-counter'})).ok,trainerId+' retry after fixture restoration');
              }
              await db.terminate();return checks;
            })()""")
            expected_denials=[e for e in b.console_errors if e.get('source')=='network'
                and e.get('url')=='http://127.0.0.1:8780/v1/projects/demo-math-trainer/databases/(default)/documents:commit'
                and '403' in e.get('text','')]
            # Batched writes travel on the write stream, so denials surface as in-page
            # permission-denied checks above rather than as logged commit 403s.
            assert len(expected_denials) in (0, 2), expected_denials
            unexpected=[e for e in b.console_errors if e not in expected_denials]
            assert not unexpected,unexpected
            (ARTIFACTS/'firestore-rules-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
            print('PASS',len(result),'real Firestore emulator checks')
    finally:
        process.terminate();process.wait(timeout=15);log.close()

if __name__=='__main__':run()
