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
        public bool Any=>enabled.Count>0;
        public bool Damage=>Allows("ped_damage")||Allows("player_damage")||Allows("vehicle_damage");
        public bool Allows(string producer)=>producer!=null&&enabled.Contains(producer);
        public string Request(string producer)=>requested.TryGetValue(producer,out var mode)?mode:"off";
        static string Mode(object value)
        {
            if(!(value is string text)||!(text=="off"||text=="shadow"||text=="on"))
                throw new ArgumentException("native_producer_mode_invalid");
            return text;
        }
        public NativeProducerPolicy(string mode="shadow",IDictionary<string,object> producers=null,string radioMode="off")
        {
            RequestedMode=Mode(mode);requested=new Dictionary<string,string>();enabled=new HashSet<string>();
            if(producers!=null&&producers.Keys.Any(key=>!names.Contains(key)))
                throw new ArgumentException("native_producer_unknown");
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
            return new NativeProducerPolicy(mode,producers,radioMode);
        }
        // Content-free local diagnostics. Requested native config is distinct
        // from initialized callbacks/sampling capabilities and channel health.
        public string Status=>"producer_request="+RequestedMode+" producer_mode="+(Any?"configured":"source_only")+
            " producer_restart_required=True configured_producers="+string.Join(",",names.Where(Allows));
    }
}
