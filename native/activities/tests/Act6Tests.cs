using System;
using System.Collections.Generic;
using LSA.Activities;

static class Act6Tests
{
    public static void Run(Action<bool,string> check)
    {
        var walk=new ModeSample {Alive=true,NavIssued=true,NavVehicleSame=true,NavDistance=1.2f};
        var ctx=new AdapterContext {Capability="walk_to"};
        check(CompletionAdapters.Judge("place_arrival",walk,ctx).Kind!="completed","ACT6 proximity alone is not arrival");
        walk.NavProgress=true;
        check(CompletionAdapters.Judge("place_arrival",walk,ctx).Kind!="progress","ACT6 movement without live task never counts");
        walk.NavTaskSeen=true;
        check(CompletionAdapters.Judge("place_arrival",walk,ctx).Kind=="progress","ACT6 progress requires physical observed motion");
        walk.NavArrived=true;
        var verdict=CompletionAdapters.Judge("place_arrival",walk,ctx);
        check(verdict.Kind=="completed" && verdict.Strength=="strong" && verdict.EvidenceKind=="distance","ACT6 confirmed walk physical arrival");
        walk.NavIssued=false;
        check(CompletionAdapters.Judge("place_arrival",walk,ctx).Kind=="failed","ACT6 refuses a missing physical task");
        walk.NavIssued=true;walk.NavArrived=false;walk.NavStuck=true;
        check(CompletionAdapters.Judge("place_arrival",walk,ctx).Reason=="no_progress","ACT6 stuck walker failure");
        walk.NavStuck=false;walk.NavTaskLost=true;
        check(CompletionAdapters.Judge("place_arrival",walk,ctx).Reason=="navigation_failed","ACT6 refuses stolen/finished task outside destination");

        var drive=new ModeSample {Alive=true,InVehicle=true,IsDriver=true,NavIssued=true,NavVehicleSame=true,NavTaskSeen=true,NavProgress=true,NavArrived=true,NavDistance=3f};
        var driving=CompletionAdapters.Judge("drive_arrival",drive,new AdapterContext{Capability="drive_to"});
        check(driving.Kind=="completed" && driving.EvidenceKind=="vehicle_motion","ACT6 vehicle completion requires real driving evidence");
        drive.IsDriver=false;
        check(CompletionAdapters.Judge("drive_arrival",drive,new AdapterContext()).Reason=="driver_required","ACT6 driver transition fences route");
        drive.IsDriver=true;drive.NavVehicleSame=false;
        check(CompletionAdapters.Judge("drive_arrival",drive,new AdapterContext()).Reason=="vehicle_mismatch","ACT6 vehicle replacement fences route");
        drive.NavVehicleSame=true;drive.InVehicle=false;
        check(CompletionAdapters.Judge("drive_arrival",drive,new AdapterContext()).Reason=="driver_required","ACT6 destroyed or exited vehicle fails");

        var table=new PlaceTable();
        var place=new PlaceAnchor {PlaceRef="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",Kind="waypoint",IncarnationId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",X=-1037f,Y=-2738f,Z=13f};
        check(table.TryAdd(place) && table.TryGet(place.PlaceRef,out var resolved) && resolved.X==place.X,"ACT6 retained exact native waypoint");
        check(!table.TryAdd(place),"ACT6 cannot duplicate place refs");
        table.Retire(place.IncarnationId);
        check(!table.TryGet(place.PlaceRef,out _),"ACT6 retired actor drops place");
        var invalid=new PlaceAnchor {PlaceRef="cccccccc-cccc-4ccc-8ccc-cccccccccccc",Kind="named",X=float.NaN,Y=0,Z=0};
        check(!table.TryAdd(invalid),"ACT6 rejects NaN destinations");
        var unknown=new PlaceAnchor {PlaceRef="dddddddd-dddd-4ddd-8ddd-dddddddddddd",Kind="unverified_world_location",X=1,Y=2,Z=3};
        check(!table.TryAdd(unknown),"ACT6 unknown world destination rejected");

        check(Array.IndexOf(ActivityContracts.CompletionAdapterIds,"place_arrival") >= 0,"ACT6 walk predicate native contract");
        check(Array.IndexOf(ActivityContracts.CompletionAdapterIds,"drive_arrival") >= 0,"ACT6 drive predicate native contract");
    }
}
