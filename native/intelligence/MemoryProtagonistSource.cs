using System;
using System.Linq;
using Rage;
using Rage.Native;
using LSA.PromotedCharacters;

namespace LSA.Intelligence
{
    // C-01 model/controlled-player proof, read only on Core's native owner
    // fiber. Unsupported player transitions and modded player models remain
    // unknown. Hashes are the three base-game player models, not NPC names.
    public static class MemoryProtagonistSource
    {
        public static object Sample(HostContext host,uint tick)
        {
            try
            {
                if(host==null ||
                   NativeFunction.CallByName<bool>("IS_CUTSCENE_ACTIVE") ||
                   NativeFunction.CallByName<bool>("IS_CUTSCENE_PLAYING") ||
                   NativeFunction.CallByName<bool>("IS_PLAYER_SWITCH_IN_PROGRESS") ||
                   NativeFunction.CallByName<bool>("NETWORK_IS_SESSION_ACTIVE"))
                    return null;
                var player=Game.LocalPlayer.Character;
                if(player==null || !player.Exists() || player.MemoryAddress==IntPtr.Zero)
                    return null;
                // Must be the native-controlled actor, not a same-model
                // ambient spawn or the last observed conversation target.
                int nativePed=NativeFunction.CallByName<int>("PLAYER_PED_ID");
                if(nativePed<=0 || nativePed!=player.Handle) return null;
                uint model=NativeFunction.CallByName<uint>("GET_ENTITY_MODEL",player);
                if(model!=unchecked((uint)player.Model.Hash))return null;
                var anchors=host.Anchors.Current.Where(a=>a.Kind=="player" &&
                    a.Handle==unchecked((ulong)player.Handle) &&
                    a.Address==player.MemoryAddress).Take(2).ToArray();
                if(anchors.Length!=1 ||
                   host.Anchors.Resolve(anchors[0].CaptureRef)==null)return null;
                string key=MemoryOwnerProofPolicy.ProtagonistKey(model);
                return new {
                    key,source="native_player_model",
                    playerCaptureRef=anchors[0].CaptureRef,
                    sampledGameTick=tick
                };
            }
            catch { return null; } // missing pinned native => unknown, never guess
        }
    }
}
