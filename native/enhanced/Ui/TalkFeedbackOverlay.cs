using System;
using System.Drawing;
using LSA.Enhanced.Input;
using Rage;

namespace LSA.Enhanced.Ui
{
    // Paints the UX4 status line and microphone meter from RPH's FrameRender, the
    // same supported draw path as the talk-target brackets (TalkTargetIndicator).
    // It only reads the immutable FeedbackView the input tick published; it does no
    // audio work, no polling and no allocation beyond the draw calls. A draw failure
    // disables only this overlay.
    sealed class TalkFeedbackOverlay
    {
        const int FailureLimit = 3;
        readonly Func<FeedbackView> source;
        int failures;
        bool disabled, hooked, failureLogged;
        public TalkFeedbackOverlay(Func<FeedbackView> source) { this.source = source ?? throw new ArgumentNullException(nameof(source)); }
        public bool Disabled => disabled;
        public void Hook()
        {
            if (hooked) return;
            Game.FrameRender += Paint;
            hooked = true;
        }
        public void Unhook()
        {
            if (!hooked) return;
            Game.FrameRender -= Paint;
            hooked = false;
        }
        void Paint(object sender,GraphicsEventArgs args)
        {
            if (disabled || args?.Graphics == null) return;
            try {
                var view = source();
                if (view == null || view.Kind == FeedbackKind.None || string.IsNullOrEmpty(view.Text)) return;
                var resolution = Game.Resolution;
                if (!FeedbackGeometry.TryLayout(resolution.Width,resolution.Height,out var layout)) return;
                var graphics = args.Graphics;
                var color = TextColor(view.Kind);
                float width = FeedbackGeometry.TextWidth(view.Text,layout.TextSize);
                graphics.DrawText(view.Text,"Arial",layout.TextSize,new PointF(layout.CenterX - width * 0.5f,layout.TextY),color);
                if (view.ShowMeter) {
                    float level = Math.Max(0f,Math.Min(1f,view.Level));
                    // Outline, dark track, then the live fill. The same filled-rectangle call the brackets use.
                    graphics.DrawRectangle(new RectangleF(layout.BarX - layout.Border,layout.BarY - layout.Border,layout.BarW + layout.Border * 2f,layout.BarH + layout.Border * 2f),Color.FromArgb(200,255,255,255));
                    graphics.DrawRectangle(new RectangleF(layout.BarX,layout.BarY,layout.BarW,layout.BarH),Color.FromArgb(210,12,12,12));
                    if (level > 0.004f) graphics.DrawRectangle(new RectangleF(layout.BarX,layout.BarY,layout.BarW * level,layout.BarH),FillColor(level));
                }
                failures = 0;
            } catch {
                if (++failures >= FailureLimit) {
                    disabled = true;
                    if (!failureLogged) { failureLogged = true; Game.LogTrivial("[UX4] talk_feedback state=unavailable reason=draw_failed"); }
                }
            }
        }
        static Color TextColor(FeedbackKind kind)
        {
            switch (kind) {
                case FeedbackKind.Error: return Color.FromArgb(240,255,110,90);
                case FeedbackKind.Recording: return Color.FromArgb(230,255,220,40);
                default: return Color.FromArgb(225,235,235,235);
            }
        }
        static Color FillColor(float level) => level < 0.7f ? Color.FromArgb(235,90,220,110) : level < 0.92f ? Color.FromArgb(235,240,210,60) : Color.FromArgb(235,240,90,70);
    }
}
