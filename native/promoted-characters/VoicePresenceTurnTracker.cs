using System;
namespace LSA.PromotedCharacters {
    // Pure policy. Only a playout-level reader (Essential's own rendered level)
    // may call Sample(); never PCM enqueue time, never an estimate.
    internal sealed class VoicePresenceTurnTracker {
        internal const int MaxTurnMs=180000, LevelExpiryMs=250, SilenceHoldMs=180;
        // Default for the legacy 0..1 peak scale used by the policy tests. The
        // production reader supplies Essential's RMS, so the native config can
        // lower this (npcVoicePresence.mouthOpenLevel) and calibrate with levelLog.
        internal const float OpenThreshold=0.04f;
        // Hysteresis: once open, a level only counts as speech while it stays above
        // CloseFraction of the open threshold, so a wavering level cannot flicker.
        internal const float CloseFraction=0.6f;
        readonly float openLevel,closeLevel;
        internal VoicePresenceTurnTracker(float openLevel=OpenThreshold) {
            if(float.IsNaN(openLevel)||float.IsInfinity(openLevel)||openLevel<=0||openLevel>1)openLevel=OpenThreshold;
            this.openLevel=openLevel;closeLevel=openLevel*CloseFraction;
        }
        internal float OpenLevel=>openLevel;
        internal struct Key : IEquatable<Key> {
            internal readonly string PedId,TurnId; internal readonly long Generation;
            internal Key(string pedId,string turnId,long generation) { PedId=pedId;TurnId=turnId;Generation=generation; }
            internal bool Valid=>!string.IsNullOrEmpty(PedId)&&PedId.Length<=128&&!string.IsNullOrEmpty(TurnId)&&TurnId.Length<=128&&Generation>0;
            public bool Equals(Key other)=>PedId==other.PedId&&TurnId==other.TurnId&&Generation==other.Generation;
            public override bool Equals(object other)=>other is Key&&Equals((Key)other);
            public override int GetHashCode()=>(PedId??"").GetHashCode()^(TurnId??"").GetHashCode()^Generation.GetHashCode();
        }
        internal bool Active {get;private set;} internal Key ActiveKey {get;private set;}
        internal int Epoch {get;private set;} internal bool HasPlayout {get;private set;} internal bool MouthOpen {get;private set;}
        long startedAt,lastSampleAt=-1,lastLoudAt=-1;
        internal bool Begin(Key key,int epoch,long at) {
            if(!key.Valid||epoch<=0||at<0)return false;
            if(Active&&Epoch==epoch&&ActiveKey.Equals(key))return true;
            Clear();Active=true;ActiveKey=key;Epoch=epoch;startedAt=at;return true;
        }
        internal bool End(Key key,int epoch) {
            if(!Active||Epoch!=epoch||!ActiveKey.Equals(key))return false;
            Clear();return true;
        }
        internal bool Sweep(int epoch,long at,bool samePed) {
            if(!Active)return false;
            if(epoch!=Epoch||at<startedAt||at-startedAt>MaxTurnMs||!samePed) {Clear();return false;}
            if(lastSampleAt>=0&&at-lastSampleAt>LevelExpiryMs) {HasPlayout=false;MouthOpen=false;}
            // A natural pause must close the mouth even if no further sample arrives.
            else if(MouthOpen&&lastLoudAt>=0&&at-lastLoudAt>=SilenceHoldMs)MouthOpen=false;
            return true;
        }
        // Playout sample only; never PCM arrival at Node/Essential's enqueue API.
        internal bool Sample(Key key,int epoch,long at,float peak) {
            if(!Active||!ActiveKey.Equals(key)||Epoch!=epoch||at<startedAt||
               at-startedAt>MaxTurnMs||(lastSampleAt>=0&&at<lastSampleAt)||
               float.IsNaN(peak)||float.IsInfinity(peak)||peak<0||peak>1)return false;
            HasPlayout=true;lastSampleAt=at;
            if(peak>=openLevel||(MouthOpen&&peak>=closeLevel)) {lastLoudAt=at;MouthOpen=true;}
            else if(MouthOpen&&lastLoudAt>=0&&at-lastLoudAt>=SilenceHoldMs)MouthOpen=false;
            return true;
        }
        // Essential reports no current speech/playout for the exact active turn:
        // close at once (no hold), but keep the turn itself active until its End.
        internal void Silence() {HasPlayout=false;MouthOpen=false;lastLoudAt=-1;}
        internal void Clear() {
            Active=false;ActiveKey=default(Key);Epoch=0;HasPlayout=false;MouthOpen=false;
            startedAt=0;lastSampleAt=-1;lastLoudAt=-1;
        }
    }
}
