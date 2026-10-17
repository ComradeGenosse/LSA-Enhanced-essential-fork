// Combine separately prepared conversation history, factual recall, M5
// command acknowledgements and M8 interpretation. Each is independently
// optional. H1/H2/M5 share one accepted-line stamp that must match. M8 carries
// its own native-owner stamp and its own verification: a revoked or stale M8
// projection drops only the opinion lane, and never invalidates H1/H2/M5 (nor
// does a failing H1/H2/M5 contributor remove an otherwise current M8 lane).
const sameStamp=(a,b)=>!!a&&!!b&&Object.keys(a).length===Object.keys(b).length&&
  Object.keys(a).every(key=>a[key]===b[key]);

export function composeIndependentForegroundMemory({history=null,recall=null,commands=null,interpretation=null,onValidation=()=>{}}={}){
 const h1=history?.status==='ready'?history:null;
 const h2=(recall?.status==='ready'||(recall?.status==='abstained'&&
   recall?.preparedRecall?.status==='ready'))?recall:null;
 // An M5 contribution exists only when the coordinator produced typed outcomes.
 const m5=commands?.status==='ready'&&Array.isArray(commands.memoryAction)&&
   commands.memoryAction.length>0?commands:null;
 const m8=interpretation?.status==='ready'&&interpretation.preparedM8?.status==='ready'?interpretation:null;
 if(!h1&&!h2&&!m5&&!m8)return null;
 const foreground=!!(h1||h2||m5);
 const h1Stamp=h1?.stamp??null,h2Stamp=h2?.preparedRecall?.stamp??null,m5Stamp=m5?.stamp??null;
 const stamps=[h1Stamp,h2Stamp,m5Stamp].filter(x=>x!==null);
 for(const stamp of stamps.slice(1))
   if(!sameStamp(stamps[0],stamp))
     // Inconsistent accepted-line stamps block the foreground contributors only;
     // M8 has its own authority stamp and verification.
     return m8?composeIndependentForegroundMemory({interpretation,onValidation})
       :Object.freeze({status:'blocked',reason:'independent_memory_stamp_mismatch'});
 let verified=false,invalidated=false,m8Verified=false,m8Invalid=false;
 // With no H1/H2/M5 contributor there is no foreground frame to authorize.
 const sendCurrent=()=>foreground&&verified&&!invalidated&&
   (!h1||h1.sendCurrent()===true)&&(!h2||h2.sendCurrent()===true)&&
   (!m5||m5.sendCurrent()===true);
 const sendCurrentInFlight=()=>foreground&&verified&&!invalidated&&
   (!h1||(h1.sendCurrentInFlight??h1.sendCurrent)()===true)&&
   (!h2||(h2.sendCurrentInFlight??h2.sendCurrent)()===true)&&
   (!m5||(m5.sendCurrentInFlight??m5.sendCurrent)()===true);
 const invalidationReason=()=>!verified||invalidated?'verification_failed':
   [h1,h2,m5].filter(Boolean).find(item=>(item.sendCurrentInFlight??item.sendCurrent)()!==true)?.invalidationReason?.()??
   (sendCurrentInFlight()?null:'source_changed');
 // M8 is verified on its own latch; its outcome never touches `invalidated`.
 async function verifyM8(){
   m8Verified=false;
   if(!m8||m8Invalid)return false;
   try{m8Verified=await m8.verifyPrepared()===true;}catch{m8Verified=false;}
   if(!m8Verified)m8Invalid=true;
   return m8Verified;
 }
 async function verifyPrepared(){
   const m8Result=await verifyM8();
   if(m8)onValidation({m8:m8Result});
   if(!foreground)return m8Result;
   verified=false;
   if(invalidated)return false;
   try{
     // M5 is verified first: it re-reads the durable command receipt.
     const m5Valid=m5?await m5.verifyPrepared()===true:true;
     const h1Result=h1?await h1.verifyPrepared():true;
     const h1Valid=h1Result===true||h1Result?.status==='ready';
     const h2Valid=h2?await h2.verifyPrepared()===true:true;
     if(!h1Valid||!h2Valid||!m5Valid){
       invalidated=true;onValidation({h1:h1Valid,h2:h2Valid,m5:m5Valid});return false;
     }
     verified=true;
     if(!sendCurrent()){
       invalidated=true;verified=false;onValidation({h1:false,h2:false,m5:false});return false;
     }
     onValidation({h1:true,h2:true,m5:true});
     return true;
   }catch{
     invalidated=true;verified=false;onValidation({h1:false,h2:false,m5:false});return false;
   }
 }
 return Object.freeze({status:'ready',reason:null,stamp:h1Stamp??h2Stamp??m5Stamp,
   h1Only:!!h1&&!h2&&!m5,commandsPrepared:!!m5,
   conversationJournal:h1?.conversationJournal??null,
   preparedRecall:h2?.preparedRecall??null,preparedM8:m8?.preparedM8??null,
   interpretationPrepared:!!m8,
   memoryAction:m5?.memoryAction??null,
   recallCurrent:(refs,seen)=>!!h2&&h2.recallCurrent(refs,seen)===true,
   // M8's own latch and send fence; independent of H1/H2/M5 validity.
   opinionCurrent:(refs,seen,{requestSent=false}={})=>!!m8&&m8Verified&&!m8Invalid&&
     m8.opinionCurrent(refs,seen,{requestSent})===true,
   verifyPrepared,sendCurrent,sendCurrentInFlight,invalidationReason});
}
