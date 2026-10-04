using System;

namespace LSA.Intelligence
{
    public sealed class WitnessReceipt
    {
        public string Observer;
        public uint SampledGameTick;
        public string Status,Reason,Channel,Basis;
        public bool KnowsSource,KnowsTarget;
    }
    public sealed class WitnessGeometry
    {
        public string EventKind,Observer,Source,Target;
        public uint SampledGameTick;
        public double DistanceMeters;
        public bool SameInterior,ClearLosInFront,SoundSourceVerified,SameAcousticSpace,ClearAcousticPath;
        public string SourceVehicle="unknown",ObserverVehicle="unknown",SoundKind;
        public bool SelfInvolved;
    }
    // Pure policy. Native adapter supplies only source-time geometry it actually sampled.
    public static class WitnessPolicy
    {
        public static double VisualRange(string kind) {
            switch(kind) {case "firing":return 50;case "injury_state":case "death":return 35;case "vehicle_transition":return 40;case "location_changed":case "activity_changed":return 35;default:return 0;}
        }
        public static WitnessReceipt Evaluate(WitnessGeometry g)
        {
            if(g==null || String.IsNullOrEmpty(g.Observer) || Double.IsNaN(g.DistanceMeters) || Double.IsInfinity(g.DistanceMeters) || g.DistanceMeters<0)
                return Unknown(g,"invalid_sample");
            if(g.SelfInvolved && (g.EventKind=="firing" || g.EventKind=="injury_state" || g.EventKind=="death"))
                return new WitnessReceipt {Observer=g.Observer,SampledGameTick=g.SampledGameTick,Status="witnessed",Reason="self_involvement",Channel="self",Basis="sampled_state",KnowsTarget=true,KnowsSource=g.EventKind=="firing"};
            double visualRange=VisualRange(g.EventKind);
            if(visualRange>0) {
                if(g.DistanceMeters>visualRange) return Negative(g,"visual_out_of_range");
                if(!g.SameInterior) return Negative(g,"different_interior");
                if(!g.ClearLosInFront) return Negative(g,"visual_blocked_or_outside_cone");
                return new WitnessReceipt {Observer=g.Observer,SampledGameTick=g.SampledGameTick,Status="witnessed",Reason="visual_clear",Channel="visual",Basis="sampled_state",KnowsSource=g.EventKind=="firing",KnowsTarget=g.Target!=null};
            }
            double soundRange=SoundRange(g.SoundKind);
            if(soundRange<=0 || !g.SoundSourceVerified) return Unknown(g,"sound_source_unverified");
            if(g.SourceVehicle=="unknown" || g.ObserverVehicle=="unknown") return Unknown(g,"vehicle_acoustics_unknown");
            if(!g.SameAcousticSpace || !g.ClearAcousticPath) return Negative(g,"acoustic_path_blocked");
            if(g.SourceVehicle=="enclosed" || g.ObserverVehicle=="enclosed") soundRange/=2.0;
            if(g.DistanceMeters>soundRange) return Negative(g,"auditory_out_of_range");
            return new WitnessReceipt {Observer=g.Observer,SampledGameTick=g.SampledGameTick,Status="witnessed",Reason="audibility_model",Channel="auditory",Basis="audibility_model",KnowsSource=false,KnowsTarget=false};
        }
        static double SoundRange(string kind) {switch(kind) {case "gunshot":return 60;case "siren":return 60;case "speech":return 12;case "impact":return 25;default:return 0;}}
        static WitnessReceipt Unknown(WitnessGeometry g,string reason)=>new WitnessReceipt {Observer=g?.Observer,SampledGameTick=g?.SampledGameTick??0,Status="unknown",Reason=reason};
        static WitnessReceipt Negative(WitnessGeometry g,string reason)=>new WitnessReceipt {Observer=g.Observer,SampledGameTick=g.SampledGameTick,Status="did_not_witness",Reason=reason};
    }
}
