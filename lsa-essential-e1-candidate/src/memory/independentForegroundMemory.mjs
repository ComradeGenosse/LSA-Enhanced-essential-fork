// Combine separately prepared conversation history and factual recall.
const sameStamp=(a,b)=>!!a&&!!b&&Object.keys(a).length===Object.keys(b).length&&
  Object.keys(a).every(key=>a[key]===b[key]);

export function composeIndependentForegroundMemory({history=null,recall=null,onValidation=()=>{}}={}){
 const h1=history?.status==='ready'?history:null;
 const h2=(recall?.status==='ready'||(recall?.status==='abstained'&&
   recall?.preparedRecall?.status==='ready'))?recall:null;
 if(!h1&&!h2)return null;
 const h1Stamp=h1?.stamp??null,h2Stamp=h2?.preparedRecall?.stamp??null;
 if(h1&&h2&&!sameStamp(h1Stamp,h2Stamp))
   return Object.freeze({status:'blocked',reason:'independent_memory_stamp_mismatch'});
 let verified=false,invalidated=false;
 const sendCurrent=()=>verified&&!invalidated&&
   (!h1||h1.sendCurrent()===true)&&(!h2||h2.sendCurrent()===true);
 async function verifyPrepared(){
   verified=false;
   if(invalidated)return false;
   try{
     const h1Result=h1?await h1.verifyPrepared():true;
     const h1Valid=h1Result===true||h1Result?.status==='ready';
     const h2Valid=h2?await h2.verifyPrepared()===true:true;
     if(!h1Valid||!h2Valid){
       invalidated=true;onValidation({h1:h1Valid,h2:h2Valid});return false;
     }
     verified=true;
     if(!sendCurrent()){
       invalidated=true;verified=false;onValidation({h1:false,h2:false});return false;
     }
     onValidation({h1:true,h2:true});
     return true;
   }catch{
     invalidated=true;verified=false;onValidation({h1:false,h2:false});return false;
   }
 }
 return Object.freeze({status:'ready',reason:null,stamp:h1Stamp??h2Stamp,
   h1Only:!!h1&&!h2,conversationJournal:h1?.conversationJournal??null,
   preparedRecall:h2?.preparedRecall??null,preparedM8:null,memoryAction:null,
   recallCurrent:(refs,seen)=>!!h2&&h2.recallCurrent(refs,seen)===true,
   opinionCurrent:()=>false,verifyPrepared,sendCurrent});
}
