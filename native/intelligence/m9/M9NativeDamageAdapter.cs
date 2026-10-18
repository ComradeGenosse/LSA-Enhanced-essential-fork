using System;
using System.Collections.Generic;

namespace LSA.Intelligence.M9
{
    // Not an event, PS2 observation, witness receipt, or model fact.
    // This only copies proof from the already pinned DamageTrackerLib callback
    // path, via SensorAdapters.RawSignal, after live native-anchor revalidation.
    // Agent H must register the callback provenance verifier on the game fiber.
    public sealed class M9CollisionEvidence
    {
        public string nativeReceiptId;
        public int damage;
        public string sourceType = "damage_tracker_vehicle_collision";
        public string vehicleCaptureRef;
        public string playerCaptureRef;
        public uint gameTick;
        public long sampledAtMs;
    }

    public sealed class M9NativeDamageAdapter
    {
        public const int MinimumCollisionDamage = 35;
        public const long MaximumCallbackAgeMs = 3000;
        readonly EntityAnchors anchors;
        readonly Func<RawSignal,bool> verifiesPinnedCallback;

        public M9NativeDamageAdapter(EntityAnchors anchors,
            Func<RawSignal,bool> verifiesPinnedCallback)
        {
            this.anchors=anchors ?? throw new ArgumentNullException(nameof(anchors));
            this.verifiesPinnedCallback=verifiesPinnedCallback ??
                throw new ArgumentNullException(nameof(verifiesPinnedCallback));
        }

        // Must be called on the native game owner fiber; the verifier must
        // authenticate this exact callback signalId, not the producer string.
        public bool TryExtract(RawSignal signal,string playerCaptureRef,
            uint currentGameTick,long now,out M9CollisionEvidence evidence)
        {
            evidence=null;
            if(signal==null || signal.producer!="vehicle_damage" ||
               signal.kind!="vehicle_damage" ||
               signal.receivedMs<0 || now<signal.receivedMs ||
               now-signal.receivedMs>MaximumCallbackAgeMs ||
               unchecked(currentGameTick-signal.gameTick)>MaximumCallbackAgeMs ||
               !Guid.TryParse(signal.signalId,out var receipt) ||
               !Guid.TryParse(signal.target,out var target) ||
               !Guid.TryParse(playerCaptureRef,out var player))return false;

            if(signal.facts==null ||
               !signal.facts.TryGetValue("classification",out var type) ||
               !(type is string) || (string)type!="collision" ||
               !signal.facts.TryGetValue("damage",out var amount) ||
               !(amount is int) || (int)amount<MinimumCollisionDamage ||
               (int)amount>100000)return false;

            // A recycled handle, absent player, or retired vehicle is not proof.
            var vehicleAnchor=anchors.Resolve(signal.target);
            var playerAnchor=anchors.Resolve(playerCaptureRef);
            if(vehicleAnchor==null || vehicleAnchor.Kind!="vehicle" ||
               playerAnchor==null || playerAnchor.Kind!="player")return false;

            bool authentic=false;
            try { authentic=verifiesPinnedCallback(signal); } catch {}
            if(!authentic)return false;
            evidence=new M9CollisionEvidence {
                nativeReceiptId=signal.signalId.ToLowerInvariant(),
                damage=(int)amount,
                vehicleCaptureRef=vehicleAnchor.CaptureRef,
                playerCaptureRef=playerAnchor.CaptureRef,
                gameTick=signal.gameTick,
                sampledAtMs=signal.receivedMs
            };
            return true;
        }
    }
}
