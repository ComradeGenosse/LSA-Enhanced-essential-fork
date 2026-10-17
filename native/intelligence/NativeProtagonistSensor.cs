using System;
using Rage;
using Rage.Native;

namespace LSA.Intelligence
{
    // Only read from the live IntelligenceIntegration.Update game-fiber owner.
    // Do not derive these facts from NPC metadata, actor names, save files or JS.
    internal struct NativePlayerModelEvidence
    {
        internal bool Qualified;
        internal uint ModelHash;
        internal static NativePlayerModelEvidence Unknown => default(NativePlayerModelEvidence);
    }

    internal static class GtaProtagonistReader
    {
        internal const uint MichaelModel=0x0D7114C9U; // player_zero
        internal const uint FranklinModel=0x9B22DBAFU; // player_one
        internal const uint TrevorModel=0x9B810FA2U; // player_two

        internal static string Name(uint model)
        {
            if(model==MichaelModel)return "michael";
            if(model==FranklinModel)return "franklin";
            if(model==TrevorModel)return "trevor";
            return "unknown";
        }

        internal static NativePlayerModelEvidence Read()
        {
            try
            {
                var player=Game.LocalPlayer;
                var ped=player?.Character;
                if(ped==null || !ped.Exists() || ped.IsDead ||
                    ped.Handle==0 || ped.MemoryAddress==IntPtr.Zero)return NativePlayerModelEvidence.Unknown;
                // During a scripted replacement, switch, online session or
                // cutscene, a recognizable story model need not be the
                // currently controlled protagonist. Fail closed.
                if(NativeFunction.CallByName<bool>("IS_CUTSCENE_ACTIVE") ||
                   NativeFunction.CallByName<bool>("IS_CUTSCENE_PLAYING") ||
                   NativeFunction.CallByName<bool>("IS_PLAYER_SWITCH_IN_PROGRESS") ||
                   NativeFunction.CallByName<bool>("NETWORK_IS_SESSION_ACTIVE"))
                    return NativePlayerModelEvidence.Unknown;
                int playerIndex=NativeFunction.CallByName<int>("PLAYER_ID");
                if(playerIndex<0 || playerIndex>31 ||
                   !NativeFunction.CallByName<bool>("IS_PLAYER_PLAYING",playerIndex))
                    return NativePlayerModelEvidence.Unknown;
                int nativePed=NativeFunction.CallByName<int>("PLAYER_PED_ID");
                int indexedPed=NativeFunction.CallByName<int>("GET_PLAYER_PED",playerIndex);
                if(nativePed==0 || indexedPed==0 || nativePed!=indexedPed ||
                   unchecked((uint)nativePed)!=ped.Handle)
                    return NativePlayerModelEvidence.Unknown;
                uint model=NativeFunction.CallByName<uint>("GET_ENTITY_MODEL",ped);
                // Re-read identity after the model read; never publish a
                // sample that straddled a player-ped replacement.
                if(!ped.Exists() || ped.IsDead ||
                   !ReferenceEquals(Game.LocalPlayer?.Character,ped) ||
                   unchecked((uint)NativeFunction.CallByName<int>("PLAYER_PED_ID"))!=ped.Handle ||
                   NativeFunction.CallByName<bool>("IS_PLAYER_SWITCH_IN_PROGRESS") ||
                   Name(model)=="unknown")
                    return NativePlayerModelEvidence.Unknown;
                return new NativePlayerModelEvidence {Qualified=true,ModelHash=model};
            }
            catch {return NativePlayerModelEvidence.Unknown;}
        }
    }

    // One instance per native host run. Never reset revision on reconnect,
    // epoch advancement, unknown evidence or ABA. The pipe itself stamps
    // stream/adapter/sequence; this payload preserves host/epoch/revision.
    internal sealed class NativeProtagonistSensor
    {
        const long MaxWireRevision=9007199254740991L;
        const long HeartbeatMs=250;
        long revision, nextPublishMs, lastSampleMs=-1;
        int connectionVersion, epoch;
        bool connected, exhausted;
        string protagonist="unknown", run;
        internal long Revision=>revision;
        internal string Current=>protagonist;

        void Advance()
        {
            if(exhausted)return;
            if(revision>=MaxWireRevision) {exhausted=true;protagonist="unknown";return;}
            revision++;
            nextPublishMs=0;
        }

        internal void Revoke()
        {
            if(connected || protagonist!="unknown")Advance();
            connected=false;connectionVersion=0;protagonist="unknown";
            nextPublishMs=0;
        }

        internal object Sample(bool channelConnected,int currentConnectionVersion,
            string hostRunId,int worldEpoch,long nowMs,Func<NativePlayerModelEvidence> read)
        {
            if(!channelConnected || currentConnectionVersion<1 ||
               string.IsNullOrEmpty(hostRunId) || worldEpoch<1 ||
               nowMs<0 || (lastSampleMs>=0 && nowMs<lastSampleMs))
            {
                Revoke();lastSampleMs=nowMs;return null;
            }
            lastSampleMs=nowMs;
            if(!connected || connectionVersion!=currentConnectionVersion ||
               epoch!=worldEpoch || run!=hostRunId)
            {
                // This is also a source-revocation boundary: even if a new
                // stream happens to read Franklin again, old Franklin cannot
                // survive as the same revision.
                Advance();connected=true;connectionVersion=currentConnectionVersion;
                epoch=worldEpoch;run=hostRunId;protagonist="unknown";
            }
            string next="unknown";
            try {
                var evidence=read?.Invoke()??NativePlayerModelEvidence.Unknown;
                if(evidence.Qualified)next=GtaProtagonistReader.Name(evidence.ModelHash);
            } catch {next="unknown";}
            if(next!=protagonist) {Advance();protagonist=next;}
            if(exhausted || (nextPublishMs>0 && nowMs<nextPublishMs))return null;
            nextPublishMs=nowMs+HeartbeatMs;
            return new {version=1,source="native_player_model",protagonist,
                hostRunId,worldEpoch,revision};
        }
    }
}
