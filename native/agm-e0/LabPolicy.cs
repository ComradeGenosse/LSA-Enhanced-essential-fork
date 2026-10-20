using System;
using System.Collections.Generic;
using System.Linq;

namespace LSA.AGM.E0
{
    // Deliberately no RPH/Essential references. This is an experiment lease,
    // not C-17's proposed production StageLease or a change to D-001.
    internal sealed class Lease
    {
        public string Id = Guid.NewGuid().ToString("N");
        public string Probe, Site, Condition, RunId, Epoch;
        public long StartedUtc;
        public uint StartedGameMs;
        public bool Cancelled;
        public readonly Dictionary<int, Owned> Entities = new Dictionary<int, Owned>();
    }
    internal sealed class Owned
    {
        public int Handle;
        public long Address;
        public uint Model;
        public uint CreatedGameMs;
        public string Kind, Role, Token, Task;
        public float StartX, StartY, StartZ;
        public bool Persistent, Lost;
        public string Incarnation => Model.ToString("X8") + ":" + CreatedGameMs + ":" + Handle + ":" + Address;
    }
    internal sealed class Limits
    {
        public const int Peds = 12, Vehicles = 6, Props = 6, Pickups = 4, Items = 4;
        public const int MaxTotal = Peds + Vehicles + Props + Pickups;
        public const int PerProbeSamples = 1500;
        public const int MaxLogBytes = 16 * 1024 * 1024;
        public const int SampleMs = 250;
        public const int TaskDurationMs = 60000, PersistenceDurationMs = 300000;
        public static readonly string[] Sites = {"terminal","grapeseed","vinewood","delperro"};
        public static readonly string[] Probes = {"e0.1","e0.2","e0.3","e0.4","e0.5","e0.6","e0.7","e0.8"};
        public static readonly string[] Tasks = {"walk","drive","flee","guard","chase","follow","combat"};
        public static bool Probe(string x) => Probes.Contains(x,StringComparer.Ordinal);
        public static bool Site(string x) => Sites.Contains(x,StringComparer.Ordinal);
        public static bool Task(string x) => Tasks.Contains(x,StringComparer.Ordinal);
        public static bool Condition(string x) => x=="essential_off" || x=="yield_off" || x=="yield_on";
        public static bool CanAdd(Lease lease,string kind)
        {
            if(lease==null || lease.Cancelled || lease.Entities.Count>=MaxTotal) return false;
            int count=lease.Entities.Values.Count(e=>e.Kind==kind && !e.Lost);
            return count < (kind=="ped"?Peds:kind=="vehicle"?Vehicles:kind=="prop"?Props:kind=="pickup"?Pickups:0);
        }
        public static bool Owns(Lease l,int handle,long address,uint model,uint created)
        {
            return l!=null && l.Entities.TryGetValue(handle,out var e) && !e.Lost &&
                e.Handle==handle && e.Address==address && e.Model==model && e.CreatedGameMs==created;
        }
        public static string Deny(string probe,string condition,string site,bool optedIn,bool scripted,bool alreadyActive)
        {
            if(!optedIn) return "lab_disabled";
            if(!Probe(probe)) return "unknown_probe";
            if(!Condition(condition)) return "invalid_condition";
            if(!Site(site)) return "site_unselected";
            if(scripted) return "scripted_world";
            if(alreadyActive) return "probe_busy";
            return null;
        }
    }
}