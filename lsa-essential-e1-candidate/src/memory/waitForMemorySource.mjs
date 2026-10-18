// Admission only: never creates native proof, changes a timeline or writes data.
export async function waitForMemorySource({ready,isCurrent,signal,deadlineAt,
  maxWaitMs=5000,pollMs=25,now=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const end=Math.min(deadlineAt,now()+maxWaitMs);
  while(!signal?.aborted&&isCurrent()){
    if(ready())return true;
    const remaining=end-now();
    if(remaining<=0)return false;
    await sleep(Math.min(pollMs,remaining));
  }
  return false;
}
