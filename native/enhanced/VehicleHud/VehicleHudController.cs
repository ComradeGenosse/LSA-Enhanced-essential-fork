using System;
using System.Drawing;
using Rage;
using Rage.Native;

namespace LSA.Enhanced.VehicleHud
{
    // Game reads stay on the loader fiber. FrameRender receives only published,
    // immutable-by-convention snapshots and never queries or mutates an entity.
    internal sealed class VehicleHudController
    {
        const int SampleEveryMs = 200;
        readonly VehicleDamageTimeline timeline = new VehicleDamageTimeline();
        volatile VehicleView published;
        volatile string mode = "full";
        long nextSample;
        int failures, drawFailures;
        bool hooked, samplerDisabled, drawDisabled;
        public string Mode => mode;
        public VehicleView Current => published;
        public void Configure(string value) { SetMode(value); }
        public void SetMode(string value)
        {
            if (value != "off" && value != "minimal" && value != "full") return;
            mode = value;
            if (value == "off") { timeline.Clear(); published = null; }
            nextSample = 0;
        }
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
            timeline.Clear(); published = null;
        }
        public void Tick(long now,bool paused)
        {
            if (mode == "off" || samplerDisabled) return;
            if (now < nextSample) return;
            nextSample = now + SampleEveryMs;
            if (paused) { timeline.Clear(); published = null; return; }
            try {
                var player = Game.LocalPlayer.Character;
                var car = player != null && player.IsValid() ? player.CurrentVehicle : null;
                if (car == null || !car.IsValid() || !car.IsCar || car.Driver == null || car.Driver.Handle != player.Handle) {
                    timeline.Clear(); published = null; failures = 0; return;
                }
                var v = Read(car);
                timeline.Update(v,now);
                published = timeline.Current;
                failures = 0;
            } catch (Exception error) {
                timeline.Clear(); published = null;
                if (++failures == 1) Game.LogTrivial("[VH1] sample_failed " + error.GetType().Name);
                if (failures >= 5) { samplerDisabled = true; Game.LogTrivial("[VH1] sampler_disabled; other LSA features unaffected"); }
            }
        }
        static VehicleReading Read(Vehicle car)
        {
            var v = new VehicleReading {
                Handle = unchecked((int)car.Handle.Value),
                Engine = car.EngineHealth, Body = NativeFunction.CallByName<float>("GET_VEHICLE_BODY_HEALTH",unchecked((int)car.Handle.Value)), Tank = car.FuelTankHealth,
                SpeedMps = car.Speed, SteeringDegrees = car.SteeringAngle, OnAllWheels = car.IsOnAllWheels
            };
            var velocity = car.Velocity;
            var forward = car.ForwardVector;
            var right = car.RightVector;
            float along = velocity.X * forward.X + velocity.Y * forward.Y;
            v.MovingForward = along > 12f;
            v.LateralSpeedMps = velocity.X * right.X + velocity.Y * right.Y;
            // Native tire IDs on standard four-wheel cars: LF=0 RF=1 LR=4 RR=5.
            // A wheel detached by an external mod does NOT necessarily report as
            // a burst tire, so we intentionally call this tire status, not wheel health.
            int[] ids = {0,1,4,5};
            for (int i = 0; i < ids.Length; i++) {
                try {
                    bool burst = NativeFunction.CallByName<bool>("IS_VEHICLE_TYRE_BURST",unchecked((int)car.Handle.Value),ids[i],false) ||
                                 NativeFunction.CallByName<bool>("IS_VEHICLE_TYRE_BURST",unchecked((int)car.Handle.Value),ids[i],true);
                    v.KnownTires |= 1 << i;
                    if (burst) v.BurstTires |= 1 << i;
                } catch { /* No invented status for unsupported wheel/native. */ }
            }
            // RPH getters are declared by the pinned SDK, but still require
            // validation on this exact Enhanced runtime. Wheels[] indexes are
            // deliberately shown as slots, not trusted physical corners.
            for (int i = 0; i < 4; i++) {
                try {
                    float health = car.Wheels[i].Health;
                    if (Plausible(health)) { v.WheelHealth[i] = health; v.KnownWheelHealth |= 1 << i; }
                } catch { /* Unsupported wheel slot: remain unknown. */ }
                try {
                    float health = car.Wheels[i].TireHealth;
                    if (Plausible(health)) { v.TireHealth[i] = health; v.KnownTireHealth |= 1 << i; }
                } catch { /* Not equivalent to puncture status. */ }
            }
            // Offset probes are VEHICLE-local sample points, NOT crash-zone
            // identities. No in-game mapping/calibration is claimed.
            float[] px = {-0.7f,0.7f,-0.7f,0.7f};
            float[] py = {1.0f,1.0f,-1.0f,-1.0f};
            for (int i = 0; i < 4; i++) {
                try {
                    var deformation = NativeFunction.CallByHash<Vector3>(0x4EC6CFBC7B2E9536UL,
                        unchecked((int)car.Handle.Value),px[i],py[i],0.45f);
                    float length = (float)Math.Sqrt(deformation.X*deformation.X +
                        deformation.Y*deformation.Y + deformation.Z*deformation.Z);
                    if (length >= 0f && length <= 5f && !float.IsNaN(length)) {
                        v.Deformation[i] = length; v.KnownDeformation |= 1 << i;
                    }
                } catch { /* Deformation probe unsupported: unavailable. */ }
            }
            return v;
        }
        static bool Plausible(float value) => !float.IsNaN(value) && !float.IsInfinity(value) &&
            value >= 0f && value <= 5000f;
        void Paint(object sender,GraphicsEventArgs args)
        {
            if (mode == "off" || drawDisabled || args?.Graphics == null) return;
            var view = published;
            if (view?.Reading == null) return;
            try {
                var screen = Game.Resolution;
                if (screen.Width < 640 || screen.Height < 400) return;
                float scale = Math.Max(0.8f,Math.Min(1.6f,screen.Height / 1080f));
                var g = args.Graphics;
                float w = 290f * scale, h = (mode == "full" ? 390f : 145f) * scale;
                float x = screen.Width - w - 24f * scale, y = screen.Height - h - 125f * scale;
                g.DrawRectangle(new RectangleF(x,y,w,h),Color.FromArgb(190,7,17,24));
                g.DrawRectangle(new RectangleF(x,y,w,2f * scale),Color.FromArgb(230,70,201,199));
                Text(g,"LSA / VEHICLE DIAGNOSTICS",x+12*scale,y+10*scale,15*scale,Color.FromArgb(255,130,233,225));
                if (mode == "minimal") {
                    Health(g,"ENG",view.Reading.Engine,x+12*scale,y+48*scale,scale);
                    Health(g,"BODY",view.Reading.Body,x+105*scale,y+48*scale,scale);
                    Health(g,"FUEL",view.Reading.Tank,x+202*scale,y+48*scale,scale);
                    Text(g,TireSummary(view.Reading),x+12*scale,y+86*scale,14*scale,Color.White);
                    if (view.DriftHint != null) Text(g,view.DriftHint,x+12*scale,y+109*scale,12*scale,Color.Orange);
                } else {
                    float bx = x + 17*scale, by = y+44*scale;
                    Outline(g,bx+27*scale,by+4*scale,75*scale,140*scale,scale,Color.FromArgb(220,67,196,195));
                    Outline(g,bx+37*scale,by+21*scale,55*scale,37*scale,scale,Color.FromArgb(180,67,196,195));
                    Outline(g,bx+37*scale,by+97*scale,55*scale,31*scale,scale,Color.FromArgb(180,67,196,195));
                    for (int i = 0; i < 4; i++) {
                        float wx = bx + (i%2==0 ? 13 : 102)*scale;
                        float wy = by + (i<2 ? 23 : 106)*scale;
                        int bit = 1 << i;
                        Color color = (view.Reading.KnownTires & bit)==0 ? Color.Gray :
                            (view.Reading.BurstTires & bit)!=0 ? Color.FromArgb(245,88,73) : Color.FromArgb(65,207,132);
                        g.DrawRectangle(new RectangleF(wx,wy,12*scale,30*scale),color);
                    }
                    float rx = x + 142*scale;
                    Health(g,"ENGINE",view.Reading.Engine,rx,by+8*scale,scale);
                    Health(g,"BODY",view.Reading.Body,rx,by+51*scale,scale);
                    Health(g,"FUEL TANK",view.Reading.Tank,rx,by+94*scale,scale);
                    Text(g,"BRAKES / SUSP  N/A",x+14*scale,y+199*scale,12*scale,Color.LightGray);
                    Text(g,view.DriftHint ?? "ALIGNMENT  UNVERIFIED",x+14*scale,y+221*scale,12*scale,view.DriftHint==null?Color.Gray:Color.Orange);
                    Text(g,"RPH WHEEL / TIRE HEALTH  (RAW, UNVERIFIED)",
                        x+14*scale,y+242*scale,10*scale,Color.FromArgb(255,130,233,225));
                    for (int i = 0; i < 4; i++) {
                        int bit = 1 << i;
                        string wheel = (view.Reading.KnownWheelHealth & bit) == 0 ? "?" :
                            Math.Round(view.Reading.WheelHealth[i]).ToString();
                        string tire = (view.Reading.KnownTireHealth & bit) == 0 ? "?" :
                            Math.Round(view.Reading.TireHealth[i]).ToString();
                        Text(g,"Slot " + i + ": W " + wheel + " / T " + tire,
                            x+14*scale,y+(256+i*14)*scale,11*scale,Color.White);
                    }
                    float maxDeformation = float.NaN;
                    for (int i = 0; i < 4; i++) if ((view.Reading.KnownDeformation & (1<<i)) != 0) {
                        if (float.IsNaN(maxDeformation) || view.Reading.Deformation[i] > maxDeformation)
                            maxDeformation = view.Reading.Deformation[i];
                    }
                    Text(g,"Deformation probes: " + (float.IsNaN(maxDeformation) ? "N/A" :
                        "max " + Math.Round(maxDeformation,2) + " raw units"),
                        x+14*scale,y+312*scale,11*scale,Color.LightGray);
                    Text(g,"RECENT DAMAGE  (LATEST LAST)",x+14*scale,y+332*scale,10*scale,Color.FromArgb(255,130,233,225));
                    int start = Math.Max(0,view.Events.Length-2);
                    for (int i = start; i < view.Events.Length; i++)
                        Text(g,view.Events[i].Text,x+14*scale,y+(349+(i-start)*17)*scale,11*scale,Color.White);
                    if (view.Events.Length==0) Text(g,"No damage changes observed",x+14*scale,y+350*scale,11*scale,Color.Gray);
                }
                drawFailures = 0;
            } catch (Exception error) {
                if (++drawFailures >= 3) { drawDisabled = true; Game.LogTrivial("[VH1] draw_disabled " + error.GetType().Name); }
            }
        }
        static void Text(Rage.Graphics g,string text,float x,float y,float size,Color color) =>
            g.DrawText(text,"Arial",size,new PointF(x,y),color);
        static void Outline(Rage.Graphics g,float x,float y,float w,float h,float s,Color color)
        {
            g.DrawRectangle(new RectangleF(x,y,w,1.5f*s),color);
            g.DrawRectangle(new RectangleF(x,y+h-1.5f*s,w,1.5f*s),color);
            g.DrawRectangle(new RectangleF(x,y,1.5f*s,h),color);
            g.DrawRectangle(new RectangleF(x+w-1.5f*s,y,1.5f*s,h),color);
        }
        static void Health(Rage.Graphics g,string name,float raw,float x,float y,float s)
        {
            bool valid = !float.IsNaN(raw) && !float.IsInfinity(raw);
            int percent = valid ? (int)Math.Round(Math.Max(0,Math.Min(100,raw/10f))) : -1;
            Color color = !valid ? Color.Gray : percent<=30 ? Color.FromArgb(245,88,73) :
                percent <=70 ? Color.FromArgb(240,183,68) : Color.FromArgb(65,207,132);
            Text(g,name,x,y,12*s,Color.White);
            Text(g,percent<0 ? "N/A" : percent+"%",x,y+16*s,15*s,color);
        }
        static string TireSummary(VehicleReading v)
        {
            if (v.KnownTires == 0) return "TIRES: unavailable";
            if ((v.BurstTires & v.KnownTires) == 0) return "TIRES: no bursts detected";
            return "TIRES: burst detected";
        }
    }
}
