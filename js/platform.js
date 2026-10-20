/* One document, one in-memory login. No password or authenticated flag in storage. */
(function(root){
  'use strict';
  root.MathTrainerConfig=Object.freeze({allowGrade3:true});
  const trainers=Object.freeze({fraction:{name:'분수트레이너',short:'분수',mark:'¼'},decimal:{name:'소수트레이너',short:'소수',mark:'0.1'}});
  root.MathPlatform=Object.freeze({trainers,
    session:()=>root.WeeklyCompetition.getIdentity(),
    classroom:()=>root.WeeklyCompetition.getIdentity()?.classroom||root.ClassRanking.getSelection(),
    logout:()=>root.WeeklyCompetition.clearIdentity(),
    submit(record){const id=record.trainerId??'fraction';if(!trainers[id])return Promise.resolve({ok:false,message:'학습 영역을 확인해 주세요.'});return root.WeeklyCompetition.submit({...record,trainerId:id});},
    watch(options,onData,onError){if(!trainers[options.trainerId])throw new Error('학습 영역을 확인해 주세요.');return root.WeeklyCompetition.watchRankings(options,onData,onError);}
  });
})(globalThis);
