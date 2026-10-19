using LSA.WPS.Lab;
using System;
using System.Linq;
using System.Collections.Generic;
class Tests
{
    static int passed;
    static void Check(bool ok,string msg) {if(!ok)throw new Exception(msg);passed++;}
    static void Throws(Action act,string msg)
    {
        try{act();}catch(ArgumentException){passed++;return;}
        catch(InvalidOperationException){passed++;return;}
        throw new Exception(msg);
    }
    static void Main()
    {
        Check(Census.Ids.Length==13 && Census.Ids.Distinct().Count()==13,"all_probes");
        Check(Census.Ids.First()=="E0.0" && Census.Ids.Last()=="E0.12","range");
        Check(!Census.ValidId("E0.13")&&!Census.ValidId("e0.0"),"exact_ids");
        Check(Census.Statuses.Length==5,"status_contract");
        Check(Census.Joaat("WEAPON_PISTOL")==0x1B06D571u,"joaat_pistol");
        Check(Census.Coverage(100,89)<.90 && Census.Coverage(100,99)==.99,"shot_thresholds");
        Check(Census.Coverage(0,4)==0 && Census.Coverage(2,4)==1,"coverage_bounds");
        Check(Census.Percentile(new[]{1.0,2,3,4,5},.95)>=4,"p95");
        Check(Census.Percentile(new[]{double.NaN,-1.0,7.0},.95)==7,"invalid_frames_filtered");
        Check(Math.Abs(Census.Distance(0,0,0,3,4,0)-5)<.0001,"thickness_distance");
        Throws(()=>Census.Limit("E0.9",2001,true),"budget_cap");
        Throws(()=>Census.Limit("E0.9",100,false),"arming");
        Check(Census.Limit("E0.9",2000,true)==2000,"budget_max");
        Throws(()=>Census.Limit("E0.5",31,true),"ordinary_probe_cap");
        var ledger=new Ledger();
        Check(Census.Ids.All(id=>ledger.Get(id)=="NOT_TESTED"),"no_fake_gta_verdicts");
        ledger.Mark("E0.0","OFFLINE_READY");Check(ledger.Get("E0.0")=="OFFLINE_READY","offline_state");
        Throws(()=>ledger.Mark("E0.0","PASS"),"status_validation");
        var copy=ledger.Snapshot();copy["E0.0"]="GTA_VERIFIED";
        Check(ledger.Get("E0.0")=="OFFLINE_READY","ledger_immutable_snapshot");
        var book=new CleanupBook();book.Own(0);book.Own(10);book.Own(10);book.Own(11);
        Check(book.Count==2&&book.Owns(11),"only_created");
        Check(book.Forget(10)&&!book.Owns(10)&&book.Count==1,"delete_cannot_retarget_foreign_handle");
        Check(book.Drain().Length==1&&book.Count==0,"cleanup_idempotent");
        var defaults=Settings.Defaults();
        Check(!defaults.enabled && !defaults.autoRunPreShot && !defaults.autoTeleportForSamples,"never_autostart_or_teleport");
        var example=new Sample{label="site",ax=430,ay=-980,az=30,bx=431,by=-981,bz=31,expectedThicknessM=.2};
        var site=AutoSampleSite.Build(Enumerable.Repeat(example,30),new[]{example});
        Check(site.IsNearby(440,-990)&&site.AcceptSafeCoord(440,-990,31),"nearby_safe_navmesh");
        Check(!site.AcceptSafeCoord(750,-980,30)&&!site.AcceptSafeCoord(440,-990,200),"reject_far_or_vertical_safe_navmesh");
        var distant=new Sample{label="distant",ax=5000,ay=-980,az=30,bx=5000,by=-981,bz=30,expectedThicknessM=.2};
        Throws(()=>AutoSampleSite.Build(Enumerable.Repeat(example,30),new[]{distant}),"reject_scattered_samples");
        Throws(()=>AutoSampleSite.Build(Enumerable.Repeat(example,29),Array.Empty<Sample>()),"reject_short_site_set");
        Check(!DestinationGate.Accept(true,false,10000,10),"nearby_player_requires_collision");
        Check(!DestinationGate.Accept(true,true,200,10),"teleported_player_requires_settling");
        Check(!DestinationGate.Accept(true,true,1000,2),"requires_consecutive_loaded_frames");
        Check(!DestinationGate.Accept(false,true,1000,10),"loaded_collision_outside_site_not_accepted");
        Check(DestinationGate.Accept(true,true,800,3),"settled_collision_accepts");
        var stability=new CollisionStability();
        Check(!stability.Poll(true,false,700),"unloaded_resets_window");
        Check(!stability.Poll(true,true,750),"first_loaded_poll_starts_window");
        Check(!stability.Poll(true,true,780),"two_polls_insufficient");
        Check(!stability.Poll(true,true,810),"three_polls_after_teleport_do_not_prove_800ms_loaded");
        Check(stability.Poll(true,true,1550)&&stability.LoadedMs==800,"continuous_800ms_accepts");
        Check(!stability.Poll(false,true,1600)&&stability.Checks==0,"leaving_region_resets_stability");
        Check(!stability.Poll(true,true,1700),"new_window_after_failure");
        Check(!stability.Poll(true,false,2400)&&stability.LoadedMs==0,"lost_collision_resets_duration");
        Check(DestinationGate.HeadingError(359.0,1.0)==2.0,"heading_wraparound");
        Check(DestinationGate.HeadingError(90.0,110.0)==20.0,"heading_delta");
        Check(PreShotPlan.Ids.SequenceEqual(new[]{"E0.0","E0.1","E0.2","E0.3"}),"safe_pre_shot_sequence");
        Check(PreShotPlan.Ids.All(PreShotPlan.Allows) && !PreShotPlan.Allows("E0.4") && !PreShotPlan.Allows("E0.9"),"no_fire_or_world_mutation_auto");
        Check(PreShotPlan.MissingGroundTruth("E0.2",29)!=null && PreShotPlan.MissingGroundTruth("E0.2",30)==null,"30_material_references_required");
        Check(PreShotPlan.MissingGroundTruth("E0.3",9)!=null && PreShotPlan.MissingGroundTruth("E0.3",10)==null,"10_wall_references_required");
        defaults.Validate();defaults.radius=100;Throws(()=>defaults.Validate(),"safety_radius");
        defaults=Settings.Defaults();defaults.entityLimit=2001;Throws(()=>defaults.Validate(),"safety_limit");
        var sample=new Sample{label="codewalker-wall",ax=1,ay=2,az=3,bx=4,by=5,bz=6,expectedThicknessM=.2};
        sample.Validate();sample.expectedThicknessM=-1;Throws(()=>sample.Validate(),"sample_invalid");
        sample.expectedThicknessM=.2;
        var groups=new SampleSets{schemaVersion=1,surfaces=new[]{sample},walls=new[]{sample}};
        groups.Validate();Check(groups.surfaces.Length==1 && groups.walls.Length==1,"distinct_sample_sets");
        groups.schemaVersion=2;Throws(()=>groups.Validate(),"reject_unknown_sample_schema");
        groups.schemaVersion=1;groups.walls=null;Throws(()=>groups.Validate(),"require_independent_wall_set");
        Console.WriteLine("PASS: "+passed+" offline checks; runtime physics NOT TESTED");
    }
}
