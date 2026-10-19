using System;

namespace LSA.Intelligence {
    // A pre-mix PER-SOURCE stereo DSP kernel. Compile and test now, but do
    // NOT attach it to the pinned Essential renderer: no authenticated
    // sample-synchronous, isolated speaker PCM hook exists in its public API.
    // The mixer already owns every provider's TTS; never create a second player.
    internal struct PromotedVoiceMixTarget {
        internal float Gain,Pan,CutoffHz;
        internal static PromotedVoiceMixTarget FromAcoustic(string grade,
            double distance,float speakerPan) {
            if(double.IsNaN(distance)||double.IsInfinity(distance)||distance<0)
                return new PromotedVoiceMixTarget {Gain=0,Pan=0,CutoffHz=1000};
            var pan=Clamp(speakerPan,-1f,1f);
            // Smooth natural rolloff. Acoustic classification has final say.
            double rolloff=1.0/(1.0+0.035*distance*distance);
            if(grade=="clear")return new PromotedVoiceMixTarget {
                Gain=(float)rolloff,Pan=pan,CutoffHz=8000f};
            if(grade=="muffled")return new PromotedVoiceMixTarget {
                Gain=(float)(rolloff*0.3),Pan=pan,CutoffHz=1000f};
            // Unknown acoustic evidence never becomes audible proof.
            return new PromotedVoiceMixTarget {Gain=0f,Pan=pan,CutoffHz=800f};
        }
        internal static float Clamp(float v,float min,float max) =>
            float.IsNaN(v)||float.IsInfinity(v)?min:Math.Max(min,Math.Min(max,v));
    }
    internal sealed class PromotedVoiceDsp {
        readonly int rate;
        readonly float fastCoeff,filterCoeff;
        volatile float targetGain,targetPan,targetCutoff=8000f;
        float gain,pan,cutoff=8000f,lowL,lowR;
        internal long MixedFrames {get;private set;}
        internal PromotedVoiceDsp(int sampleRate) {
            if(sampleRate<8000||sampleRate>192000)
                throw new ArgumentOutOfRangeException(nameof(sampleRate));
            rate=sampleRate;
            fastCoeff=(float)(1-Math.Exp(-1.0/(0.035*rate)));
            filterCoeff=(float)(1-Math.Exp(-1.0/(0.060*rate)));
        }
        internal void SetTarget(PromotedVoiceMixTarget t) {
            targetGain=PromotedVoiceMixTarget.Clamp(t.Gain,0,1);
            targetPan=PromotedVoiceMixTarget.Clamp(t.Pan,-1,1);
            targetCutoff=PromotedVoiceMixTarget.Clamp(t.CutoffHz,100,
                Math.Min(rate*0.45f,16000f));
        }
        // Called only by the renderer thread for one isolated speaker's PCM
        // samples BEFORE mixing. Output is additive stereo float32; absolutely
        // never call this with the already-mixed global playback stream.
        internal void MixInto(float[] source,int sourceOffset,int frames,
            float[] destinationStereo,int destinationFrameOffset) {
            if(source==null||destinationStereo==null)
                throw new ArgumentNullException(source==null?nameof(source):nameof(destinationStereo));
            if(sourceOffset<0||frames<0||destinationFrameOffset<0||
                frames>source.Length-sourceOffset ||
                destinationFrameOffset>(destinationStereo.Length/2) ||
                frames>(destinationStereo.Length/2)-destinationFrameOffset)
                throw new ArgumentOutOfRangeException(nameof(frames));
            for(int i=0;i<frames;i++) {
                gain+=(targetGain-gain)*fastCoeff;
                pan+=(targetPan-pan)*fastCoeff;
                cutoff+=(targetCutoff-cutoff)*filterCoeff;
                float alpha=(float)(1.0-Math.Exp(-2.0*Math.PI*cutoff/rate));
                float sample=source[sourceOffset+i];
                if(float.IsNaN(sample)||float.IsInfinity(sample))sample=0;
                // Equal-power pan preserves perceived loudness on motion.
                float l=sample*(float)Math.Sqrt((1-pan)*0.5);
                float r=sample*(float)Math.Sqrt((1+pan)*0.5);
                lowL+=alpha*(l-lowL);
                lowR+=alpha*(r-lowR);
                int index=(destinationFrameOffset+i)*2;
                destinationStereo[index]+=lowL*gain;
                destinationStereo[index+1]+=lowR*gain;
            }
            MixedFrames+=frames;
        }
        // Exact interruption/world epoch/identity retirement must discard
        // filter history; no previous NPC's voice may bleed into the next.
        internal void Reset() {
            targetGain=0;targetPan=0;targetCutoff=8000;
            gain=0;pan=0;cutoff=8000;lowL=0;lowR=0;MixedFrames=0;
        }
    }
}
