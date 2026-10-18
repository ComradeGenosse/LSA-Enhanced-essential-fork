using System;
using System.Collections.Generic;
using System.Linq;

namespace LSA.Intelligence
{
    // Native-owned startup configuration only. No live re-registration, new
    // source authority, scanner or fiber. The master gate cannot be overridden.
    public sealed class NativeProducerPolicy
    {
        static readonly string[] names={"ped_damage","player_damage","vehicle_damage","shooting","state","action","playback","radio"};
        readonly Dictionary<string,string> requested;
        readonly HashSet<string> enabled;
        public string RequestedMode {get;}
        // The M9 sampler never counts as an ordinary PS1 producer: it cannot
        // by itself enable witness evaluation, damage callbacks or the Director.
        public bool Any=>enabled.Any(name=>name!=M9Producer);
        public bool Damage=>Allows("ped_damage")||Allows("player_damage")||Allows("vehicle_damage");
        public bool Allows(string producer)=>producer!=null&&enabled.Contains(producer);
        public string Request(string producer)=>requested.TryGetValue(producer,out var mode)?mode:"off";
        static string Mode(object value)
        {
            if(!(value is string text)||!(text=="off"||text=="shadow"||text=="on"))
                throw new ArgumentException("native_producer_mode_invalid");
            return text;
        }
        // M9 GTA event state sampler. It is NOT part of the legacy "all
        // producers" default: it stays off unless a native-owned request names
        // it (producers.m9) or an M9 events.* capability is explicitly on/shadow.
        public const string M9Producer="m9";
        static readonly string[] m9Capabilities={"events.crash","events.rollover","events.airborne","events.water","events.wanted","events.wasted","events.busted"};
        public bool M9=>Allows(M9Producer);
        public NativeProducerPolicy(string mode="shadow",IDictionary<string,object> producers=null,string radioMode="off",string m9Mode="off")
        {
            RequestedMode=Mode(mode);requested=new Dictionary<string,string>();enabled=new HashSet<string>();
            if(producers!=null&&producers.Keys.Any(key=>!names.Contains(key)&&key!=M9Producer))
                throw new ArgumentException("native_producer_unknown");
            var m9=producers!=null&&producers.TryGetValue(M9Producer,out var m9Supplied)?Mode(m9Supplied):Mode(m9Mode);
            requested[M9Producer]=m9;
            if(mode!="off"&&m9!="off")enabled.Add(M9Producer);
            foreach(var name in names) {
                var value=producers!=null&&producers.TryGetValue(name,out var supplied)?Mode(supplied):
                    producers!=null&&producers.Count>0?"off":mode;
                requested[name]=value;
                // Radio retains its existing separate opt-in even with PS1 on.
                if(mode!="off"&&value!="off"&&(name!="radio"||radioMode=="shadow"))enabled.Add(name);
            }
        }
        public static NativeProducerPolicy FromConfig(IDictionary<string,object> capabilities,IDictionary<string,object> producers,string radioMode)
        {
            var mode=capabilities==null||capabilities.Count==0?"shadow":
                capabilities.TryGetValue("ps1.producers",out var value)?Mode(value):"off";
            // Any explicit M9 event family request (on or shadow) starts the one
            // shared state sampler; JS owns the per-family mode. A malformed
            // literal is treated as off and never disables the P2 host.
            string m9="off";
            if(capabilities!=null)
                foreach(var id in m9Capabilities)
                    if(capabilities.TryGetValue(id,out var requestedMode)&&(requestedMode as string=="on"||requestedMode as string=="shadow"))m9="on";
            return new NativeProducerPolicy(mode,producers,radioMode,m9);
        }
        // Content-free local diagnostics. Requested native config is distinct
        // from initialized callbacks/sampling capabilities and channel health.
        public string Status=>"producer_request="+RequestedMode+" producer_mode="+(Any?"configured":"source_only")+
            " producer_restart_required=True configured_producers="+string.Join(",",names.Where(Allows))+(M9?" m9_sampler=requested":"");
    }
}
