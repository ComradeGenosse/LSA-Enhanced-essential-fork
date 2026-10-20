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
        // Shape-test option comparison (synthetic observations only; no game data).
        var miss=new RayObs(false,0,0,0,0,0);
        var matchObs=new RayObs(true,111u,7,10,0,0);
        var otherObs=new RayObs(true,222u,7,10,0,0);
        Check(OptionsAnalysis.Baseline==7 && OptionsAnalysis.Alternate==0,"options_under_test");
        Check(OptionsAnalysis.ClassifyMaterial(matchObs,matchObs,111u)=="MATCH_BOTH","opt_both_match");
        Check(OptionsAnalysis.ClassifyMaterial(miss,matchObs,111u)=="RECOVERED_BY_OPT0_SEE_THROUGH_CLASS","opt0_recovers_miss");
        Check(OptionsAnalysis.ClassifyMaterial(otherObs,matchObs,111u)=="RECOVERED_BY_OPT0_OPT7_HIT_OTHER","opt0_recovers_other_hit");
        Check(OptionsAnalysis.ClassifyMaterial(miss,miss,111u)=="MISS_BOTH","miss_both");
        Check(OptionsAnalysis.ClassifyMaterial(miss,otherObs,111u)=="OPT0_HITS_OTHER_MATERIAL","opt0_other_material");
        Check(OptionsAnalysis.ClassifyMaterial(matchObs,miss,111u)=="OPT7_ONLY_OPT0_SEES_NOTHING","opt7_only");
        Check(OptionsAnalysis.ClassifyMaterial(otherObs,otherObs,111u)=="OTHER_MATERIAL_BOTH","other_both");
        Check(OptionsAnalysis.MaterialOutcome(matchObs,112u)=="other_material","material_outcome_is_independent_of_baseline");
        var front=new RayObs(true,111u,7,0,0,0);
        var back=new RayObs(true,111u,7,0,0.5,0);
        var farBack=new RayObs(true,111u,7,0,0.75,0);
        var otherEntityBack=new RayObs(true,111u,9,0,0.5,0);
        var otherMaterialBack=new RayObs(true,333u,7,0,0.5,0);
        Check(OptionsAnalysis.PairOutcome(front,back,111u,.5)=="CONFIRMED_PAIR","pair_confirmed");
        Check(OptionsAnalysis.PairOutcome(front,farBack,111u,.5)=="THICKNESS_MISMATCH","pair_thickness_mismatch");
        Check(OptionsAnalysis.PairOutcome(front,otherEntityBack,111u,.5)=="ENTITY_SPLIT","pair_entity_split_never_a_thickness");
        Check(OptionsAnalysis.PairOutcome(front,otherMaterialBack,111u,.5)=="MATERIAL_MISMATCH","pair_material_mismatch");
        Check(OptionsAnalysis.PairOutcome(front,miss,111u,.5)=="MISS","pair_miss");
        Check(OptionsAnalysis.SameObservation(front,new RayObs(true,111u,7,0,0.005,0)) && !OptionsAnalysis.SameObservation(front,back),"same_observation_tolerance");
        Check(OptionsAnalysis.SameObservation(miss,miss) && !OptionsAnalysis.SameObservation(miss,front),"same_observation_miss");
        Check(OptionsAnalysis.ClassifyWall("CONFIRMED_PAIR","CONFIRMED_PAIR",true)=="MATCH_BOTH","wall_match_both");
        Check(OptionsAnalysis.ClassifyWall("THICKNESS_MISMATCH","CONFIRMED_PAIR",false)=="RECOVERED_BY_OPT0","wall_recovered");
        Check(OptionsAnalysis.ClassifyWall("ENTITY_SPLIT","ENTITY_SPLIT",true)=="UNCHANGED_BY_OPTIONS:ENTITY_SPLIT","wall_unchanged_by_options");
        Check(OptionsAnalysis.ClassifyWall("CONFIRMED_PAIR","ENTITY_SPLIT",false).StartsWith("OPT0_DISTURBS_CONFIRMED_PAIR"),"wall_opt0_disturbs");
        Check(OptionsAnalysis.ClassifyWall("MISS","THICKNESS_MISMATCH",false)=="CHANGED_BUT_UNRESOLVED:MISS/THICKNESS_MISMATCH","wall_changed_unresolved");
        var layerSame=new List<LayerObs>{new LayerObs(1,1u,5),new LayerObs(1.5,1u,5)};
        var layerMat=new List<LayerObs>{new LayerObs(1,1u,5),new LayerObs(1.5,2u,5)};
        var layerEnt=new List<LayerObs>{new LayerObs(1,1u,5),new LayerObs(1.5,1u,6),new LayerObs(2,1u,5)};
        Check(LayerAnalysis.Describe(null)=="NO_LAYERS" && LayerAnalysis.Describe(new List<LayerObs>{new LayerObs(1,1u,5)})=="SINGLE_SURFACE","layer_empty_single");
        Check(LayerAnalysis.Describe(layerSame)=="SAME_ENTITY_SAME_MATERIAL_LAYERS","layer_same_entity_same_material");
        Check(LayerAnalysis.Describe(layerMat)=="SAME_ENTITY_MULTI_MATERIAL" && LayerAnalysis.MaterialChanges(layerMat)==1,"layer_same_entity_multi_material");
        Check(LayerAnalysis.Describe(layerEnt)=="MULTIPLE_ENTITIES" && LayerAnalysis.EntityChanges(layerEnt)==2,"layer_multiple_entities");
        Check(LayerAnalysis.MaxLayers==8 && LayerAnalysis.AdvanceM>0 && LayerAnalysis.AdvanceM<=.05,"advance_scan_bounded");
        // Oblique geometry (synthetic flat slab along +X, thickness .5, normal toward the ray origin = +X).
        double[] os0,oe0;
        ObliqueAnalysis.Build(0,0,0,1,0,0,0,1.0,.5,1.5,out os0,out oe0);
        Check(Math.Abs(os0[0]-1.0)<1e-9&&Math.Abs(oe0[0]-(-2.0))<1e-9&&Math.Abs(os0[1])<1e-9,"oblique_zero_is_normal_incidence");
        ObliqueAnalysis.Build(0,0,0,1,0,0,40,1.0,.5,1.5,out os0,out oe0);
        double olen=Census.Distance(os0[0],os0[1],os0[2],oe0[0],oe0[1],oe0[2]);
        Check(Math.Abs(olen-(1.0+ObliqueAnalysis.ExpectedPath(.5,40)+1.5))<1e-9,"oblique_length_bounded");
        Check(Math.Abs(os0[0]-Math.Cos(40*Math.PI/180))<1e-9&&Math.Abs(Math.Abs(os0[1])-Math.Sin(40*Math.PI/180))<1e-9&&Math.Abs(os0[2])<1e-9,"oblique_tilts_in_horizontal_plane");
        // the oblique ray must pass through the entry point
        double fx=os0[0]+(oe0[0]-os0[0])/olen*1.0,fy=os0[1]+(oe0[1]-os0[1])/olen*1.0;
        Check(Math.Abs(fx)<1e-9&&Math.Abs(fy)<1e-9,"oblique_ray_passes_through_entry_point");
        ObliqueAnalysis.Build(0,0,0,0,0,1,20,1.0,.5,1.5,out os0,out oe0);
        Check(os0[2]>.9&&!double.IsNaN(os0[0]),"oblique_vertical_normal_fallback");
        Throws(()=>{double[] a,b;ObliqueAnalysis.Build(0,0,0,0,0,0,20,1,.5,1.5,out a,out b);},"oblique_rejects_zero_normal");
        Throws(()=>{double[] a,b;ObliqueAnalysis.Build(0,0,0,1,0,0,80,1,.5,1.5,out a,out b);},"oblique_rejects_grazing_angle");
        double want40=ObliqueAnalysis.ExpectedPath(.5,40);
        Check(Math.Abs(want40-.5/Math.Cos(40*Math.PI/180))<1e-12&&want40>.65,"oblique_expected_path");
        // Entry/exit pair search (synthetic scans along a 1.5 m segment; slab faces at 0.5 and 1.0 from the ends -> separation 0.5).
        var fwdSlab=new List<LayerObs>{new LayerObs(0.5,1u,5,1,0,0)};
        var revSlab=new List<LayerObs>{new LayerObs(0.5,1u,5,-1,0,0)};
        var pairs=PairSearch.Candidates(fwdSlab,revSlab,1.5);
        Check(pairs.Count==1&&Math.Abs(pairs[0].SeparationM-.5)<1e-9&&PairSearch.Describe(pairs)=="UNIQUE_PAIR","pair_unique_slab");
        Check(PairSearch.MatchesExpected(pairs[0],.505)&&!PairSearch.MatchesExpected(pairs[0],.6),"pair_expected_tolerance");
        // unrelated nearby object: reverse scan sees another entity first, then the genuine back face as a later layer
        var revOccluded=new List<LayerObs>{new LayerObs(.405,9u,6),new LayerObs(.5,1u,5)};
        var occ=PairSearch.Candidates(fwdSlab,revOccluded,1.5);
        Check(occ.Count==1&&occ[0].Reverse==1&&Math.Abs(occ[0].SeparationM-.5)<1e-9,"pair_skips_unrelated_entity_layer");
        // different entity or material is never paired
        Check(PairSearch.Candidates(fwdSlab,new List<LayerObs>{new LayerObs(.5,1u,6)},1.5).Count==0,"pair_requires_same_entity");
        Check(PairSearch.Candidates(fwdSlab,new List<LayerObs>{new LayerObs(.5,2u,5)},1.5).Count==0,"pair_requires_same_material");
        Check(PairSearch.Describe(PairSearch.Candidates(fwdSlab,new List<LayerObs>{new LayerObs(1.1,1u,5)},1.5))=="NO_PAIR","pair_overlap_rejected");
        Check(PairSearch.Describe(PairSearch.Candidates(null,revSlab,1.5))=="NO_PAIR","pair_null_safe");
        var multi=PairSearch.Candidates(new List<LayerObs>{new LayerObs(.5,1u,5),new LayerObs(.52,1u,5)},revSlab,1.5);
        Check(multi.Count==2&&PairSearch.Describe(multi)=="AMBIGUOUS_PAIRS","pair_ambiguous_not_unique");
        // angle consistency
        double s0=.5;
        var at40=new List<PairCandidate>{new PairCandidate{Forward=0,Reverse=0,SeparationM=want40,Entity=5,Material=1u,
            EntryNormal=new[]{1.0,0,0},ExitNormal=new[]{-1.0,0,0}}};
        var at40wrong=new List<PairCandidate>{new PairCandidate{Forward=0,Reverse=0,SeparationM=s0,Entity=5,Material=1u,
            EntryNormal=new[]{1.0,0,0},ExitNormal=new[]{-1.0,0,0}}};
        Check(want40>.65&&Math.Abs(want40-.5/Math.Cos(40*Math.PI/180))<1e-12,"oblique_expected_path");
        Check(PairSearch.AngleConsistency(at40,s0,40,pairs[0])=="ANGLE_CONSISTENT","angle_consistent_pair");
        Check(PairSearch.AngleConsistency(at40wrong,s0,40,pairs[0])=="NO_CONSISTENT_PAIR","angle_unrelated_pair_rejected");
        Check(PairSearch.AngleConsistency(null,s0,40,pairs[0])=="NO_PAIR" && PairSearch.AngleConsistency(new List<PairCandidate>(),s0,40,pairs[0])=="NO_PAIR","angle_no_pair");
        var impostor=new PairCandidate{SeparationM=want40,Entity=6,Material=1u,EntryNormal=new[]{1.0,0,0},ExitNormal=new[]{-1.0,0,0}};
        Check(PairSearch.AngleConsistency(new[]{impostor},s0,40,pairs[0])=="NO_CONSISTENT_PAIR","angle_other_entity_same_thickness_rejected");
        impostor.Entity=5;impostor.Material=2u;
        Check(PairSearch.AngleConsistency(new[]{impostor},s0,40,pairs[0])=="NO_CONSISTENT_PAIR","angle_other_material_same_thickness_rejected");
        impostor.Material=1u;impostor.EntryNormal=new[]{-1.0,0,0};impostor.ExitNormal=new[]{1.0,0,0};
        Check(PairSearch.AngleConsistency(new[]{impostor},s0,40,pairs[0])=="NO_CONSISTENT_PAIR","angle_wrong_face_orientation_rejected");
        impostor.EntryNormal=new[]{0.0,0,0};impostor.ExitNormal=new[]{0.0,0,0};
        Check(PairSearch.AngleConsistency(new[]{impostor},s0,40,pairs[0])=="NO_CONSISTENT_PAIR","angle_missing_normals_not_verified");
        Check(PairSearch.Corroborate("UNIQUE_PAIR",new[]{"ANGLE_CONSISTENT","ANGLE_CONSISTENT"})=="CORROBORATED_THICKNESS","corroborated_requires_unique_and_all_angles");
        Check(PairSearch.Corroborate("UNIQUE_PAIR",new[]{"ANGLE_CONSISTENT","NO_CONSISTENT_PAIR"})=="NO_THICKNESS_CLAIM:ANGLE_INCONSISTENT","one_bad_angle_blocks_claim");
        Check(PairSearch.Corroborate("UNIQUE_PAIR",new string[0])=="NO_THICKNESS_CLAIM:NOT_ANGLE_TESTED","untested_angles_block_claim");
        Check(PairSearch.Corroborate("AMBIGUOUS_PAIRS",new[]{"ANGLE_CONSISTENT"})=="NO_THICKNESS_CLAIM:AMBIGUOUS_NORMAL_PAIR","ambiguous_normal_pair_blocks_claim");
        Check(PairSearch.Corroborate("NO_PAIR",null)=="NO_THICKNESS_CLAIM:NO_PAIR","no_pair_no_claim");
        // E0.4 passive correlation (synthetic): camera at origin looking +Y (heading 0), level.
        var dirN=ShotCorrelation.Direction(0,0);
        Check(Math.Abs(dirN[0])<1e-9&&Math.Abs(dirN[1]-1)<1e-9&&Math.Abs(dirN[2])<1e-9,"heading_zero_looks_north");
        var dirW=ShotCorrelation.Direction(0,90);
        Check(Math.Abs(dirW[0]+1)<1e-9&&Math.Abs(dirW[1])<1e-9,"heading_90_looks_west");
        var dirUp=ShotCorrelation.Direction(30,0);
        Check(Math.Abs(dirUp[2]-.5)<1e-9&&Math.Abs(dirUp[1]-Math.Cos(30*Math.PI/180))<1e-9,"pitch_raises_aim");
        var camPos=new[]{0.0,0,0};
        Check(ShotCorrelation.OffAxisDeg(camPos,dirN,new[]{0.0,20,0})<1e-6&&ShotCorrelation.Classify(ShotCorrelation.OffAxisDeg(camPos,dirN,new[]{0.0,20,0}))=="ON_CAMERA_RAY","impact_on_ray");
        Check(ShotCorrelation.Classify(ShotCorrelation.OffAxisDeg(camPos,dirN,new[]{1.0,20,0}))=="ON_CAMERA_RAY","small_spread_on_ray");
        Check(ShotCorrelation.Classify(ShotCorrelation.OffAxisDeg(camPos,dirN,new[]{2.5,20,0}))=="NEAR_CAMERA_RAY","spread_near_ray");
        Check(ShotCorrelation.Classify(ShotCorrelation.OffAxisDeg(camPos,dirN,new[]{20.0,20,0}))=="OFF_CAMERA_RAY","impact_far_from_ray");
        Check(ShotCorrelation.Classify(ShotCorrelation.OffAxisDeg(camPos,dirN,new[]{0.0,0,0}))=="UNDEFINED","impact_at_camera_undefined");
        Check(ShotCorrelation.Classify(ShotCorrelation.OffAxisDeg(camPos,dirN,new[]{0.0,-10,0}))=="OFF_CAMERA_RAY","impact_behind_camera_off_ray");
        var latched=new List<double[]>{new[]{1.0,2,3},new[]{1.0,2,3},new[]{1.0,2,3},new[]{4.0,5,6},new[]{4.0,5,6},new[]{1.0,2,3}};
        Check(ShotCorrelation.DistinctImpactRuns(latched)==3&&ShotCorrelation.DistinctImpactRuns(new List<double[]>())==0,"latched_impacts_counted_once_lower_bound");
        // E0.5 phantom policy and budget (no GTA call).
        Check(PhantomCollision.Classify(40,30,false)=="CLEAR_WITHIN_THRESHOLD"&&PhantomCollision.Classify(100,30,false)=="CLEAR_WITHIN_THRESHOLD","phantom_within_threshold");
        Check(PhantomCollision.Classify(101,30,false)=="PHANTOM_OVER_THRESHOLD_DELETED_ENTITIES_MAY_BE_UNSOUND","phantom_over_100ms_flagged");
        Check(PhantomCollision.Classify(-1,30,false)=="PERSISTENT_PHANTOM_DELETED_ENTITIES_UNSOUND","phantom_never_clears_flagged");
        Check(PhantomCollision.Classify(10,12,false)=="INCOMPLETE","phantom_incomplete_never_passes");
        Check(PhantomCollision.Classify(40,30,true)=="PHANTOM_REAPPEARED_DELETED_ENTITIES_UNSOUND","phantom_reappears_after_first_clear");
        Check(!PhantomCollision.DeletedEntityVisible(true,99,22)&&!PhantomCollision.DeletedEntityVisible(false,22,22)&&
            PhantomCollision.DeletedEntityVisible(true,22,22),"unrelated_collision_does_not_mean_phantom");
        Check(PhantomCollision.WithinBudget(3,2,3)&&!PhantomCollision.WithinBudget(4,2,3)&&!PhantomCollision.WithinBudget(3,3,3)&&!PhantomCollision.WithinBudget(0,0,3)&&!PhantomCollision.WithinBudget(3,2,50),"e05_bounded_lab_budget");
        Check(!PreShotPlan.Allows("E0.5"),"e05_never_in_unattended_suite");
        Console.WriteLine("PASS: "+passed+" offline checks; runtime physics NOT TESTED");
    }
}
