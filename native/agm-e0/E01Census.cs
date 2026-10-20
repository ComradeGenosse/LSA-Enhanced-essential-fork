using System;
using System.Diagnostics;
using Rage;
using Rage.Native;

namespace LSA.AGM.E0
{
    // Separate E0.1-only sequential census. No tasks, NPC adoption or mission writes.
    internal sealed partial class LabRuntime
    {
        private const int E01Count=80;
        private readonly string[] e01Peds={"a_m_m_business_01","a_m_y_business_01","a_m_m_bevhills_01","a_f_y_business_01"};
        private readonly string[] e01Vehicles={"asea","blista","primo","ingot"};
        private readonly string[] e01Props={"prop_cs_cardbox_01","prop_roadcone02a","prop_tool_box_04","prop_boxpile_02b"};
        private sealed class SpawnTrial
        {
            public int Number,KindTrial;
            public string Id,Kind,Model,Failure;
            public bool Delayed,Created,Immediate,Stable=true,Cleanup,Deleted,PostFirst,PostLast,OneSecond,FiveSecond,Absent=true;
            public uint CreatedMs,DeletedMs;
            public Owned Item;
        }
        private string e01Mode="extended";
        private SpawnTrial e01Current;
        private Vector3 e01StartPosition;
        private int e01NegPassed,e01NegFailed,e01DelayedPassed,e01DelayedCount,e01FullyVerified,e01Failed;
        private long e01SpawnTicks,e01DeleteTicks;
        public void SetE01Mode(string mode)
        {
            if(active!=null){Print("Cannot change E0.1 mode during a probe.");return;}
            if(mode!="baseline"&&mode!="extended"){Print("Use AGME01Mode baseline|extended.");return;}
            e01Mode=mode;Print("E0.1 mode="+mode);
        }
        private static double ToMs(long ticks)=>ticks*1000.0/Stopwatch.Frequency;
        private void E01Start()
        {
            e01Current=null;e01NegPassed=e01NegFailed=e01DelayedPassed=e01DelayedCount=e01FullyVerified=e01Failed=0;
            e01SpawnTicks=e01DeleteTicks=0;
            e01StartPosition=Game.LocalPlayer.Character.Position;
            Log("e01_baseline",new{mode=e01Mode,planned=E01Count,perKind=20,
                delayedTrials=e01Mode=="extended"?16:0,
                pedCount=World.GetAllPeds().Length,vehicleCount=World.GetAllVehicles().Length,
                objectCount=World.GetAllObjects().Length,
                pedCapacity=World.PedCapacity,vehicleCapacity=World.VehicleCapacity,
                objectCapacity=World.ObjectCapacity,essential=essential.Status,
                note="RPH pool capacity and enumerated count do not prove free headroom or total-frame impact"});
            foreach(var item in new[]{new {kind="ped",model="asea",name="wrong_class"},
                new {kind="ped",model="agm_invalid_e01_model_73bc",name="invalid_model"}})
            {
                int before=active.Entities.Count;
                bool refused=false;
                try{SafeModel(item.model,item.kind);}catch(InvalidOperationException){refused=true;}
                bool ok=refused&&active.Entities.Count==before;
                if(ok)e01NegPassed++;else e01NegFailed++;
                Log("e01_negative_control",new{control=item.name,rejected=ok,actorWrites=nativeWrites});
            }
            bool ownerRefused=!Limits.Owns(active,-1,-1,0,0);
            if(ownerRefused)e01NegPassed++;else e01NegFailed++;
            Log("e01_negative_control",new{control="unowned_handle",rejected=ownerRefused,actorWrites=nativeWrites});
            if(e01NegFailed>0)throw new InvalidOperationException("e01_negative_control_failure");
        }
        private Owned SpawnE01(SpawnTrial trial)
        {
            var p=ScatteredPosition();
            switch(trial.Kind){
                case "ped":return MakePed("e01_"+trial.Id,p,trial.Model);
                case "vehicle":return MakeVehicle("e01_"+trial.Id,p,trial.Model);
                case "prop":return MakeProp("e01_"+trial.Id,p,trial.Model);
                case "pickup":return MakePickup("e01_"+trial.Id,p,trial.Model);
                default:throw new InvalidOperationException("unknown_e01_kind");
            }
        }
        private void E01Begin(uint gameMs)
        {
            int index=spawnRound,kindIndex=index%4,kindTrial=index/4+1;
            string kind=kindIndex==0?"ped":kindIndex==1?"vehicle":kindIndex==2?"prop":"pickup";
            string model=kindIndex==0?e01Peds[(kindTrial-1)%e01Peds.Length]:
                kindIndex==1?e01Vehicles[(kindTrial-1)%e01Vehicles.Length]:
                kindIndex==2?e01Props[(kindTrial-1)%e01Props.Length]:PickupName;
            var trial=new SpawnTrial{
                Number=index+1,KindTrial=kindTrial,Kind=kind,Model=model,
                Id="e01-"+(index+1).ToString("D3"),
                Delayed=e01Mode=="extended" && kindTrial%5==0};
            e01Current=trial;spawnRound++;spawnTotal++;
            if(trial.Delayed)e01DelayedCount++;
            if(kindTrial==1||kindTrial==10||kindTrial==20)E01Population(trial,"before");
            Log("e01_trial_start",new{trial=trial.Id,kind,kindTrial,model,delayed=trial.Delayed,
                mode=e01Mode,actorWrites=nativeWrites});
            long start=Stopwatch.GetTimestamp();
            try{
                trial.Item=SpawnE01(trial);trial.Created=true;
                trial.CreatedMs=unchecked((uint)Game.GameTime);
                spawnSuccess++;
                if(kind=="ped"&&essential.CanYield){
                    bool subscribed=essential.Observe(trial.Item.Handle,trial.Item.Address,trial.Item.Model);
                    Log("e01_essential_observe",new{trial=trial.Id,subscribed,readOnly=true});
                }
                trial.Immediate=E01Readback(trial,"immediate");
                if(!trial.Immediate)trial.Failure="immediate_readback_failed";
            }catch(Exception ex){
                trial.Failure="spawn_error:"+ex.GetType().Name+":"+ex.Message;
                Log("e01_spawn_failure",new{trial=trial.Id,kind,model,reason=trial.Failure});
            }finally{
                long ticks=Stopwatch.GetTimestamp()-start;e01SpawnTicks+=ticks;
                Log("e01_spawn_timing",new{trial=trial.Id,elapsedWallMs=ToMs(ticks),
                    scope="spawn+native_readback+model_loading+fiber_yields_not_frame_time"});
            }
            if(!trial.Created)E01Delete(trial);
        }
        private bool E01Readback(SpawnTrial trial,string phase)
        {
            var e=trial.Item;
            if(e==null)return false;
            bool exists=false,strongIdentity=false;
            bool? onScreen=null,collisionLoaded=null,persistent=null;
            float? groundDelta=null,displacement=null;
            string issue=null;
            if(e.Kind=="pickup"){
                try{exists=NativeFunction.CallByName<bool>("DOES_PICKUP_EXIST",e.Handle);}
                catch(Exception ex){issue=ex.GetType().Name;}
            }else{
                var entity=Find(e);
                exists=entity!=null;strongIdentity=exists&&Same(e,entity);
                if(exists)try{
                    var p=entity.Position;
                    displacement=Vector3.Distance(p,new Vector3(e.StartX,e.StartY,e.StartZ));
                    persistent=entity.IsPersistent;
                    float? ground=World.GetGroundZ(p,true,false);
                    if(ground.HasValue)groundDelta=p.Z-ground.Value;
                    onScreen=NativeFunction.CallByName<bool>("IS_ENTITY_ON_SCREEN",entity);
                    collisionLoaded=NativeFunction.CallByName<bool>("HAS_COLLISION_LOADED_AROUND_ENTITY",entity);
                }catch(Exception ex){issue="auxiliary_sensor:"+ex.GetType().Name;}
            }
            bool ok=exists&&(e.Kind=="pickup"||strongIdentity);
            Log("e01_readback",new{trial=trial.Id,phase,kind=e.Kind,model=trial.Model,
                e.Handle,e.Incarnation,exists,strongIdentity,weakPickupHandle=e.Kind=="pickup",
                success=ok,displacementM=displacement,groundDeltaM=groundDelta,
                onScreen,collisionLoaded,persistent,sensorIssue=issue,
                essential=kindEssential(trial),actorWrites=nativeWrites});
            return ok;
        }
        private string kindEssential(SpawnTrial trial)=>trial.Kind=="ped"&&essential.CanYield?
            essential.Snapshot(trial.Item.Handle):"not_sampled";
        private void E01Delete(SpawnTrial trial)
        {
            if(trial.Cleanup)return;
            trial.Cleanup=true;trial.DeletedMs=unchecked((uint)Game.GameTime);
            long start=Stopwatch.GetTimestamp();
            if(trial.Item!=null){
                if(trial.Kind=="ped"&&essential.CanYield)
                    essential.Forget(trial.Item.Handle,trial.Item.Address,trial.Item.Model);
                CleanupOwned("e01_"+trial.Id);
                trial.Deleted=!active.Entities.ContainsKey(trial.Item.Handle);
            }else trial.Deleted=true;
            long ticks=Stopwatch.GetTimestamp()-start;e01DeleteTicks+=ticks;
            Log("e01_delete_timing",new{trial=trial.Id,deleted=trial.Deleted,
                elapsedWallMs=ToMs(ticks),scope="deletion+ownership_journal_not_frame_time"});
            if(!trial.Deleted)trial.Failure="cleanup_unresolved";
        }
        private void E01AfterDelete(SpawnTrial trial,string phase)
        {
            bool absent=true;
            if(trial.Item!=null){
                if(trial.Kind=="pickup"){
                    try{absent=!NativeFunction.CallByName<bool>("DOES_PICKUP_EXIST",trial.Item.Handle);}
                    catch{absent=false;}
                }else absent=Find(trial.Item)==null;
            }
            trial.Absent&=absent;
            Log("e01_post_delete",new{trial=trial.Id,phase,absent,kind=trial.Kind,
                incarnation=trial.Item?.Incarnation,weakPickupHandle=trial.Kind=="pickup",
                actorWrites=nativeWrites});
            if(!absent){trial.Failure="post_delete_still_present";journalRisk=true;}
        }
        private void E01Population(SpawnTrial trial,string phase)
        {
            Log("e01_population",new{trial=trial.Id,phase,
                peds=World.GetAllPeds().Length,vehicles=World.GetAllVehicles().Length,
                objects=World.GetAllObjects().Length,essential=essential.Status,
                note="population shifts include ambient GTA traffic; no ambient actor writes"});
        }
        private void E01Finish(SpawnTrial trial)
        {
            bool passed=trial.Created&&trial.Immediate&&trial.Stable&&trial.Deleted&&trial.Absent&&trial.Failure==null;
            if(passed)e01FullyVerified++;else e01Failed++;
            if(passed&&trial.Delayed)e01DelayedPassed++;
            Log("e01_trial_result",new{trial=trial.Id,kind=trial.Kind,model=trial.Model,
                delayed=trial.Delayed,created=trial.Created,immediate=trial.Immediate,
                stability=trial.Stable,deleted=trial.Deleted,postDelete=trial.Absent,
                passed,reason=trial.Failure??"none",actorWrites=nativeWrites});
            if(trial.KindTrial==1||trial.KindTrial==10||trial.KindTrial==20)E01Population(trial,"after");
            e01Current=null;
        }
        private void E01Summary()
        {
            Log("e01_summary",new{mode=e01Mode,planned=E01Count,attempted=spawnRound,
                constructorReadbacks=spawnSuccess,fullyVerified=e01FullyVerified,
                failed=e01Failed,delayedAttempted=e01DelayedCount,delayedPassed=e01DelayedPassed,
                negativePassed=e01NegPassed,negativeFailed=e01NegFailed,actorWrites=nativeWrites,
                avgSpawnWallMs=spawnRound==0?0:ToMs(e01SpawnTicks)/spawnRound,
                avgDeleteWallMs=spawnRound==0?0:ToMs(e01DeleteTicks)/spawnRound,
                runtimeEvidenceRequired=true,videoCorroborationRequired=true});
        }
        private void E01Advance(uint gameMs)
        {
            if(e01Current==null){
                if(spawnRound>=E01Count){E01Summary();Stop(e01Failed==0?"completed":"completed_with_failures");return;}
                if(Vector3.Distance(Game.LocalPlayer.Character.Position,e01StartPosition)>10f){
                    E01Summary();Stop("player_left_test_site");return;
                }
                E01Begin(gameMs);return;
            }
            var trial=e01Current;
            if(!trial.Cleanup){
                if(trial.Delayed&&trial.Created&&trial.Immediate){
                    uint elapsed=unchecked(gameMs-trial.CreatedMs);
                    if(elapsed>=1000 && !trial.OneSecond){
                        trial.OneSecond=true;
                        if(!E01Readback(trial,"1000ms")){trial.Stable=false;trial.Failure="lost_at_1000ms";}
                    }
                    if(elapsed<5000)return;
                    if(!trial.FiveSecond){
                        trial.FiveSecond=true;
                        if(!E01Readback(trial,"5000ms")){trial.Stable=false;trial.Failure="lost_at_5000ms";}
                    }
                }
                E01Delete(trial);
                if(!trial.Deleted){E01Finish(trial);Stop("e01_cleanup_failed");}
                return;
            }
            uint age=unchecked(gameMs-trial.DeletedMs);
            if(age>=250 && !trial.PostFirst){
                trial.PostFirst=true;E01AfterDelete(trial,"250ms");
            }
            if(age>=750 && !trial.PostLast){
                trial.PostLast=true;E01AfterDelete(trial,"750ms");
            }
            if(trial.PostFirst && trial.PostLast && age>=750){
                bool unsafeCleanup=!trial.Absent;
                E01Finish(trial);
                if(unsafeCleanup)Stop("e01_post_delete_failure");
            }
        }
    }
}