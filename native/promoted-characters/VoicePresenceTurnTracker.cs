using System;
namespace LSA.PromotedCharacters {
    // Pure policy. Only an actual output-renderer PCM tap may call Sample().
    internal sealed class VoicePresenceTurnTracker {
        internal const int MaxTurnMs=180000, LevelExpiryMs=250, SilenceHoldMs=180;
        internal const float OpenThreshold=0.04f;
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
            return true;
        }
        // Playout sample only; never PCM arrival at Node/Essential's enqueue API.
        internal bool Sample(Key key,int epoch,long at,float peak) {
            if(!Active||!ActiveKey.Equals(key)||Epoch!=epoch||at<startedAt||
               at-startedAt>MaxTurnMs||(lastSampleAt>=0&&at<lastSampleAt)||
               float.IsNaN(peak)||float.IsInfinity(peak)||peak<0||peak>1)return false;
            HasPlayout=true;lastSampleAt=at;
            if(peak>=OpenThreshold) {lastLoudAt=at;MouthOpen=true;}
            else if(MouthOpen&&lastLoudAt>=0&&at-lastLoudAt>=SilenceHoldMs)MouthOpen=false;
            return true;
        }
        internal void Clear() {
            Active=false;ActiveKey=default(Key);Epoch=0;HasPlayout=false;MouthOpen=false;
            startedAt=0;lastSampleAt=-1;lastLoudAt=-1;
        }
    }
}
