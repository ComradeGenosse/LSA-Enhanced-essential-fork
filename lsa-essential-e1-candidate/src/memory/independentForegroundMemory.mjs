// Combine separately prepared conversation history, factual recall, M5
// command acknowledgements and M8 interpretation. Each is independently
// optional; the same accepted player line and source stamp must back every
// contributor that is present. M8 is subjective and purely additive: its own
// failure removes only the opinion frame, never H1/H2/M5 contributions.
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
 const h1Stamp=h1?.stamp??null,h2Stamp=h2?.preparedRecall?.stamp??null,m5Stamp=m5?.stamp??null,
   m8Stamp=m8?.stamp??null;
 const stamps=[h1Stamp,h2Stamp,m5Stamp,m8Stamp].filter(x=>x!==null);
 for(const stamp of stamps.slice(1))
   if(!sameStamp(stamps[0],stamp))
     return Object.freeze({status:'blocked',reason:'independent_memory_stamp_mismatch'});
 let verified=false,invalidated=false,m8Valid=!!m8;
 const sendCurrent=()=>verified&&!invalidated&&
   (!h1||h1.sendCurrent()===true)&&(!h2||h2.sendCurrent()===true)&&
   (!m5||m5.sendCurrent()===true);
 async function verifyPrepared(){
   verified=false;
   if(invalidated)return false;
   try{
     // M5 is verified first: it re-reads the durable command receipt.
     const m5Valid=m5?await m5.verifyPrepared()===true:true;
     const h1Result=h1?await h1.verifyPrepared():true;
     const h1Valid=h1Result===true||h1Result?.status==='ready';
     const h2Valid=h2?await h2.verifyPrepared()===true:true;
     // M8 is verified last and never poisons the factual contributors.
     if(m8){
       let ok=false;try{ok=await m8.verifyPrepared()===true;}catch{}
       m8Valid=ok&&m8Valid;
     }
     if(!h1Valid||!h2Valid||!m5Valid){
       invalidated=true;m8Valid=false;
       onValidation({h1:h1Valid,h2:h2Valid,m5:m5Valid,m8:false});return false;
     }
     verified=true;
     if(!sendCurrent()){
       invalidated=true;verified=false;m8Valid=false;
       onValidation({h1:false,h2:false,m5:false,m8:false});return false;
     }
     onValidation({h1:true,h2:true,m5:true,m8:m8Valid});
     return true;
   }catch{
     invalidated=true;verified=false;m8Valid=false;
     onValidation({h1:false,h2:false,m5:false,m8:false});return false;
   }
 }
 return Object.freeze({status:'ready',reason:null,stamp:h1Stamp??h2Stamp??m5Stamp??m8Stamp,
   h1Only:!!h1&&!h2&&!m5&&!m8,commandsPrepared:!!m5,interpretationPrepared:!!m8,
   conversationJournal:h1?.conversationJournal??null,
   preparedRecall:h2?.preparedRecall??null,preparedM8:m8?.preparedM8??null,
   memoryAction:m5?.memoryAction??null,
   recallCurrent:(refs,seen)=>!!h2&&h2.recallCurrent(refs,seen)===true,
   // Needs the composite proof AND M8's own latch; false for any other source.
   opinionCurrent:(refs,seen)=>!!m8&&verified&&!invalidated&&m8Valid&&
     m8.opinionCurrent(refs,seen)===true,
   verifyPrepared,sendCurrent});
}
