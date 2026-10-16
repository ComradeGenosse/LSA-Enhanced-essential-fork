// Combine separately prepared conversation history, factual recall and M5
// command acknowledgements. Each is independently optional; the same accepted
// player line and source stamp must back every contributor that is present.
const sameStamp=(a,b)=>!!a&&!!b&&Object.keys(a).length===Object.keys(b).length&&
  Object.keys(a).every(key=>a[key]===b[key]);

export function composeIndependentForegroundMemory({history=null,recall=null,commands=null,onValidation=()=>{}}={}){
 const h1=history?.status==='ready'?history:null;
 const h2=(recall?.status==='ready'||(recall?.status==='abstained'&&
   recall?.preparedRecall?.status==='ready'))?recall:null;
 // An M5 contribution exists only when the coordinator produced typed outcomes.
 const m5=commands?.status==='ready'&&Array.isArray(commands.memoryAction)&&
   commands.memoryAction.length>0?commands:null;
 if(!h1&&!h2&&!m5)return null;
 const h1Stamp=h1?.stamp??null,h2Stamp=h2?.preparedRecall?.stamp??null,m5Stamp=m5?.stamp??null;
 const stamps=[h1Stamp,h2Stamp,m5Stamp].filter(x=>x!==null);
 for(const stamp of stamps.slice(1))
   if(!sameStamp(stamps[0],stamp))
     return Object.freeze({status:'blocked',reason:'independent_memory_stamp_mismatch'});
 let verified=false,invalidated=false;
 const sendCurrent=()=>verified&&!invalidated&&
   (!h1||h1.sendCurrent()===true)&&(!h2||h2.sendCurrent()===true)&&
   (!m5||m5.sendCurrent()===true);
 const sendCurrentInFlight=()=>verified&&!invalidated&&
   (!h1||(h1.sendCurrentInFlight??h1.sendCurrent)()===true)&&
   (!h2||(h2.sendCurrentInFlight??h2.sendCurrent)()===true)&&
   (!m5||(m5.sendCurrentInFlight??m5.sendCurrent)()===true);
 const invalidationReason=()=>!verified||invalidated?'verification_failed':
   [h1,h2,m5].filter(Boolean).find(item=>(item.sendCurrentInFlight??item.sendCurrent)()!==true)?.invalidationReason?.()??
   (sendCurrentInFlight()?null:'source_changed');
 async function verifyPrepared(){
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
   preparedRecall:h2?.preparedRecall??null,preparedM8:null,
   memoryAction:m5?.memoryAction??null,
   recallCurrent:(refs,seen)=>!!h2&&h2.recallCurrent(refs,seen)===true,
   opinionCurrent:()=>false,verifyPrepared,sendCurrent,sendCurrentInFlight,invalidationReason});
}
