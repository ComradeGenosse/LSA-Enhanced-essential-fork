using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Threading;
using LosSantosAlive.Audio;

namespace LSA.PromotedCharacters {
    // Read-only diagnostic of the exact pinned Essential DLL. This class
    // never creates/ends a turn, drains a queue, or emits native acknowledgments.
    // Metadata tokens are verified against the expected field types before use.
    // All failures report UNKNOWN, not an empty buffer or completed playback.
    internal static class NpcPlaybackStateProbe {
        // From the SHA-256-pinned LosSantosAlive.dll:
        // 0x04000B78: NpcPlaybackCoordinator synchronization object
        // 0x04000B7A: Dictionary<string,NpcAudioTurn> active turns
        const int NativeGateToken=0x04000B78, NativeTurnsToken=0x04000B7A;
        internal struct Snapshot {
            internal string Status;
            internal bool StreamEnded,PlaybackStarted,CompletionEmitted,Cancelled;
            internal int EstimatedPlaybackEndAt,LastChunkAt,CreatedAt;
            internal string LogFields => "native_turn="+(Status??"unknown")+
                (Status=="matched"
                    ? " stream_ended="+(StreamEnded?1:0)+
                      " playback_started="+(PlaybackStarted?1:0)+
                      " completion_emitted="+(CompletionEmitted?1:0)+
                      " cancelled="+(Cancelled?1:0)+
                      " estimated_end_game_ms="+EstimatedPlaybackEndAt+
                      " last_chunk_game_ms="+LastChunkAt+
                      " created_game_ms="+CreatedAt
                    : "");
        }
        static bool attempted,supported;
        static FieldInfo gateField,turnsField;
        static object initGate=new object();

        static bool Initialize() {
            lock(initGate) {
                if(attempted)return supported;
                attempted=true;
                try {
                    var owner=typeof(NpcPlaybackCoordinator);
                    var module=owner.Module;
                    var sync=module.ResolveField(NativeGateToken);
                    var turns=module.ResolveField(NativeTurnsToken);
                    if(sync.DeclaringType!=owner || turns.DeclaringType!=owner ||
                       !sync.IsStatic || !turns.IsStatic || sync.FieldType!=typeof(object))
                        return false;
                    var ty=turns.FieldType;
                    if(!ty.IsGenericType || ty.GetGenericTypeDefinition()!=typeof(Dictionary<,>))return false;
                    var args=ty.GetGenericArguments();
                    if(args.Length!=2 || args[0]!=typeof(string) ||
                       args[1].FullName!="LosSantosAlive.Audio.NpcAudioTurn")return false;
                    foreach(var name in new [] {"PedId","TurnId","GenerationId","StreamEnded",
                        "PlaybackStarted","CompletionEmitted","Cancelled","CreatedAt","LastChunkAt",
                        "EstimatedPlaybackEndAt"}) {
                        var field=args[1].GetField(name,BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic);
                        if(field==null || field.IsStatic)return false;
                    }
                    gateField=sync;turnsField=turns;supported=true;
                } catch {supported=false;}
                return supported;
            }
        }
        internal static Snapshot Read(string pedId,string turnId,long generation) {
            if(string.IsNullOrEmpty(pedId)||string.IsNullOrEmpty(turnId)||generation<=0)
                return new Snapshot {Status="invalid"};
            if(!Initialize())return new Snapshot {Status="layout_unavailable"};
            try {
                return ReadMatching(gateField.GetValue(null),turnsField.GetValue(null) as IDictionary,
                    pedId,turnId,generation);
            } catch {return new Snapshot {Status="probe_unavailable"};}
        }
        // Also usable with fake objects in offline tests; exact tuple is
        // mandatory and no other turn's state can leak into this snapshot.
        internal static Snapshot ReadMatching(object sync,IDictionary turns,
            string pedId,string turnId,long generation) {
            if(sync==null||turns==null)return new Snapshot {Status="unavailable"};
            bool taken=false;
            try {
                Monitor.TryEnter(sync,0,ref taken);
                if(!taken)return new Snapshot {Status="lock_busy"};
                int count=0;
                foreach(DictionaryEntry entry in turns) {
                    // Bound reflective work on the game thread.
                    if(++count>64)return new Snapshot {Status="turn_capacity"};
                    var turn=entry.Value;
                    if(turn==null)continue;
                    var type=turn.GetType();
                    const BindingFlags flags=BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic;
                    var p=type.GetField("PedId",flags);
                    var t=type.GetField("TurnId",flags);
                    var g=type.GetField("GenerationId",flags);
                    if(p==null||t==null||g==null ||
                       !string.Equals(p.GetValue(turn) as string,pedId,StringComparison.Ordinal) ||
                       !string.Equals(t.GetValue(turn) as string,turnId,StringComparison.Ordinal) ||
                       Convert.ToInt64(g.GetValue(turn))!=generation)continue;
                    var result=new Snapshot {Status="matched"};
                    result.StreamEnded=ReadBool(type,turn,"StreamEnded");
                    result.PlaybackStarted=ReadBool(type,turn,"PlaybackStarted");
                    result.CompletionEmitted=ReadBool(type,turn,"CompletionEmitted");
                    result.Cancelled=ReadBool(type,turn,"Cancelled");
                    result.CreatedAt=ReadInt(type,turn,"CreatedAt");
                    result.LastChunkAt=ReadInt(type,turn,"LastChunkAt");
                    result.EstimatedPlaybackEndAt=ReadInt(type,turn,"EstimatedPlaybackEndAt");
                    return result;
                }
                return new Snapshot {Status="not_found"};
            } catch {return new Snapshot {Status="probe_unavailable"};}
            finally {if(taken)Monitor.Exit(sync);}
        }
        static bool ReadBool(Type type,object value,string name) =>
            (bool)type.GetField(name,BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic).GetValue(value);
        static int ReadInt(Type type,object value,string name) =>
            Convert.ToInt32(type.GetField(name,BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic).GetValue(value));
    }
}
