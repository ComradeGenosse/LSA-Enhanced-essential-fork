using System;
using System.Collections.Generic;

namespace LSA.PromotedCharacters
{
    internal struct TalkRect
    {
        public float X, Y, W, H;
        public TalkRect(float x,float y,float w,float h) { X = x; Y = y; W = w; H = h; }
    }
    // Screen-pixel brackets around a projected point. The marker is shifted back
    // onto the screen so a head bone that sits just inside a vehicle roof or
    // window edge still has a visible cue. Ranking uses the unclamped point.
    internal static class TalkTargetGeometry
    {
        public const float Half = 22f, Arm = 16f, Thick = 3f;
        public static float CenterError(float x,float y,float screenW,float screenH)
        {
            if (screenW <= 0f || screenH <= 0f) return float.MaxValue;
            float dx = x - screenW * 0.5f, dy = y - screenH * 0.5f;
            return (float)Math.Sqrt(dx * dx + dy * dy);
        }
        public static bool OnScreen(float x,float y,float screenW,float screenH) =>
            screenW > 0f && screenH > 0f && x >= 0f && y >= 0f && x <= screenW && y <= screenH;
        public static bool TryBrackets(float x,float y,float screenW,float screenH,List<TalkRect> rects,out float labelX,out float labelY)
        {
            rects?.Clear();
            labelX = labelY = 0f;
            if (rects == null || screenW < Half * 2f || screenH < Half * 2f) return false;
            float cx = Math.Max(Half,Math.Min(screenW - Half,x));
            float cy = Math.Max(Half,Math.Min(screenH - Half,y));
            float left = cx - Half, right = cx + Half - Thick, top = cy - Half, bottom = cy + Half - Thick;
            Add(rects,left,top,Arm,Thick); Add(rects,left,top,Thick,Arm);
            Add(rects,right - Arm + Thick,top,Arm,Thick); Add(rects,right,top,Thick,Arm);
            Add(rects,left,bottom,Arm,Thick); Add(rects,left,bottom - Arm + Thick,Thick,Arm);
            Add(rects,right - Arm + Thick,bottom,Arm,Thick); Add(rects,right,bottom - Arm + Thick,Thick,Arm);
            labelX = cx; labelY = Math.Max(12f,top - 8f);
            return true;
        }
        public static string CycleLabel(int index,int count) => index > 0 && count > 0 ? index + "/" + count : null;
        static void Add(List<TalkRect> rects,float x,float y,float w,float h) { if (w > 0f && h > 0f) rects.Add(new TalkRect(x,y,w,h)); }
    }
}
