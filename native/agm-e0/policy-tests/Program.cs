using System;
using LSA.AGM.E0;
class Program
{
    static int fail;
    static void Assert(bool condition,string label){if(!condition){Console.Error.WriteLine("FAILED "+label);fail++;}}
    static void Main()
    {
        var l=new Lease{Probe="e0.2",Site="terminal",Condition="yield_on"};
        Assert(Limits.Deny("e0.2","yield_on","terminal",true,false,false)==null,"valid");
        Assert(Limits.Deny("e0.9","yield_on","terminal",true,false,false)=="unknown_probe","no_E0.9");
        Assert(Limits.Deny("e0.1","yield_on","terminal",true,true,false)=="scripted_world","mission_gate");
        Assert(Limits.Deny("e0.1","yield_on","terminal",true,false,true)=="probe_busy","one_lease");
        Assert(Limits.Deny("e0.1","yield_on","terminal",false,false,false)=="lab_disabled","default_off");
        for(int i=0;i<Limits.Peds;i++) {
            Assert(Limits.CanAdd(l,"ped"),"ped_capacity_before_"+i);
            l.Entities.Add(i+1,new Owned{Handle=i+1,Kind="ped",Address=i+123,Model=1234,CreatedGameMs=4});
        }
        Assert(!Limits.CanAdd(l,"ped"),"ped_capacity_bound");
        Assert(Limits.CanAdd(l,"vehicle"),"vehicle_capacity_independent");
        Assert(Limits.Owns(l,1,123,1234,4),"owner_exact");
        Assert(!Limits.Owns(l,1,999,1234,4),"handle_reuse_address");
        Assert(!Limits.Owns(l,1,123,9999,4),"handle_reuse_model");
        Assert(!Limits.Owns(l,1,123,1234,999),"handle_reuse_time");
        l.Cancelled=true;
        Assert(!Limits.CanAdd(l,"vehicle"),"cancellation_blocks_creation");
        Console.WriteLine(fail==0?"AGM-E0 policy tests PASS":"AGM-E0 policy tests FAIL "+fail);
        if(fail>0)Environment.Exit(1);
    }
}