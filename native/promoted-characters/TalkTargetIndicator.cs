using System;
using System.Collections.Generic;
using System.Drawing;
using Rage;

namespace LSA.PromotedCharacters
{
    internal struct TalkProjection
    {
        public float X, Y, ScreenW, ScreenH, CenterError;
        public bool OnScreen;
    }
    // Screen-space marker for the selected ped. Brackets are cached on Core's
    // Update and painted from RPH's FrameRender, which is the supported draw
    // path. A draw failure disables only the marker.
    internal sealed class TalkTargetIndicator
    {
        const int FailureLimit = 3;
        sealed class Frame
        {
            public TalkRect[] Rects = new TalkRect[0];
            public string Label;
            public float LabelX, LabelY;
        }
        static TalkTargetIndicator active;
        Frame frame;
        int failures;
        bool disabled, failureLogged;
        public string State => disabled ? "unavailable" : frame != null ? "ready" : "off";
        public bool Disabled => disabled;
        public void EnsureHooked()
        {
            if (active == this) return;
            if (active != null) Game.FrameRender -= active.Paint;
            active = this;
            Game.FrameRender += Paint;
        }
        public void Detach()
        {
            if (active != this) return;
            Game.FrameRender -= Paint;
            active = null;
            frame = null;
        }
        public static TalkProjection Project(Ped ped)
        {
            var result = new TalkProjection {CenterError = float.MaxValue};
            if (ped == null) return result;
            Vector3 head;
            try { head = ped.GetBonePosition(PedBoneId.Head); }
            catch { head = ped.Position; head.Z += 1f; }
            var screen = World.ConvertWorldPositionToScreenPosition(head);
            var resolution = Game.Resolution;
            result.X = screen.X; result.Y = screen.Y; result.ScreenW = resolution.Width; result.ScreenH = resolution.Height;
            result.OnScreen = TalkTargetGeometry.OnScreen(result.X,result.Y,result.ScreenW,result.ScreenH);
            result.CenterError = TalkTargetGeometry.CenterError(result.X,result.Y,result.ScreenW,result.ScreenH);
            return result;
        }
        public void Publish(Ped ped,int cycleIndex,int cycleCount)
        {
            if (disabled || ped == null) { frame = null; return; }
            try {
                var projected = Project(ped);
                var rects = new List<TalkRect>();
                if (!TalkTargetGeometry.TryBrackets(projected.X,projected.Y,projected.ScreenW,projected.ScreenH,rects,out float labelX,out float labelY)) { frame = null; return; }
                frame = new Frame {Rects = rects.ToArray(),Label = TalkTargetGeometry.CycleLabel(cycleIndex,cycleCount),LabelX = labelX,LabelY = labelY};
                failures = 0;
            } catch {
                frame = null;
                if (++failures >= FailureLimit) { disabled = true; if (!failureLogged) { failureLogged = true; Game.LogTrivial("[UX4] talk_indicator state=unavailable reason=draw_failed"); } }
            }
        }
        public void Clear() { frame = null; }
        void Paint(object sender,GraphicsEventArgs args)
        {
            var draw = frame;
            if (disabled || draw == null || args?.Graphics == null) return;
            try {
                var color = Color.FromArgb(230,255,220,40);
                foreach (var rect in draw.Rects) args.Graphics.DrawRectangle(new RectangleF(rect.X,rect.Y,rect.W,rect.H),color);
                if (draw.Label != null) args.Graphics.DrawText(draw.Label,"Arial",18f,new PointF(draw.LabelX,draw.LabelY),color);
            } catch {
                frame = null;
                if (++failures >= FailureLimit) { disabled = true; if (!failureLogged) { failureLogged = true; Game.LogTrivial("[UX4] talk_indicator state=unavailable reason=draw_failed"); } }
            }
        }
    }
}
