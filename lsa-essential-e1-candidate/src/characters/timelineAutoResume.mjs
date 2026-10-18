// Binds an authenticated native host context to the P2 store and, only when
// memoryK.autoResumeSingleTimeline is true, resumes the previously selected
// timeline so the player does not have to confirm it in the editor each launch.
// Default off: with the flag unset this is exactly the old setVerifiedHostContext call.
export function bindHostContext(store,context,{autoResume=false,onSafeFailure=()=>{}}={}) {
  const bound=store.setVerifiedHostContext(context);
  if(!bound||autoResume!==true||typeof store.resumeSelectedTimeline!=='function')return Promise.resolve(null);
  // The store re-checks authority inside its serialized queue; a disconnect,
  // epoch change or ambiguous boundary before then simply refuses the resume.
  return store.resumeSelectedTimeline(context).catch(() => {onSafeFailure();return null;});
}
