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
        Check(!defaults.enabled && !defaults.autoRunPreShot,"never_autostart");
        Check(PreShotPlan.Ids.SequenceEqual(new[]{"E0.0","E0.1","E0.2","E0.3"}),"safe_pre_shot_sequence");
        Check(PreShotPlan.Ids.All(PreShotPlan.Allows) && !PreShotPlan.Allows("E0.4") && !PreShotPlan.Allows("E0.9"),"no_fire_or_world_mutation_auto");
        Check(PreShotPlan.MissingGroundTruth("E0.2",29)!=null && PreShotPlan.MissingGroundTruth("E0.2",30)==null,"30_material_references_required");
        Check(PreShotPlan.MissingGroundTruth("E0.3",9)!=null && PreShotPlan.MissingGroundTruth("E0.3",10)==null,"10_wall_references_required");
        defaults.Validate();defaults.radius=100;Throws(()=>defaults.Validate(),"safety_radius");
        defaults=Settings.Defaults();defaults.entityLimit=2001;Throws(()=>defaults.Validate(),"safety_limit");
        var sample=new Sample{label="codewalker-wall",ax=1,ay=2,az=3,bx=4,by=5,bz=6,expectedThicknessM=.2};
        sample.Validate();sample.expectedThicknessM=-1;Throws(()=>sample.Validate(),"sample_invalid");
        Console.WriteLine("PASS: "+passed+" offline checks; runtime physics NOT TESTED");
    }
}
