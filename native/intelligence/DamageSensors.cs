using System;
using System.Collections.Generic;
using DamageTrackerLib;
using DamageTrackerLib.DamageInfo;
using Rage;

namespace LSA.Intelligence
{
    // Isolated optional dependency. Only invoked after verifying the already-loaded assembly pin.
    internal sealed class DamageSensors : IDamageSensors
    {
        readonly SensorAdapters sensors;
        readonly Func<uint,object,string> ped,vehicle;
        readonly Func<string,bool> critical;
        readonly Func<long> now;
        readonly Func<uint> tick;
        public bool Running => DamageTrackerService.IsRunning;
        public DamageSensors(SensorAdapters sensors,Func<uint,object,string> ped,Func<uint,object,string> vehicle,Func<string,bool> critical,Func<long> now,Func<uint> tick)
        {
            this.sensors=sensors;this.ped=ped;this.vehicle=vehicle;this.critical=critical;this.now=now;this.tick=tick;
            try {DamageTrackerService.OnPedTookDamage+=PedDamage;DamageTrackerService.OnPlayerTookDamage+=PlayerDamage;DamageTrackerService.OnVehicleTookDamage+=VehicleDamage;}
            catch {Dispose();throw;}
        }
        // Payload handles are only looked up in the previously validated immutable index.
        // No native entity operations or handle re-resolution on the callback thread.
        void PedDamage(Ped victim,Ped attacker,PedDamageInfo info) {sensors.RecordDamageCallback("ped_damage");Copy("ped_damage",victim,attacker,info);}
        void PlayerDamage(Ped victim,Ped attacker,PedDamageInfo info) {sensors.RecordDamageCallback("player_damage");Copy("player_damage",victim,attacker,info);}
        void Copy(string producer,Ped victim,Ped attacker,PedDamageInfo info)
        {
            try { var target=ped(info.PedHandle,victim);sensors.Damage(producer,target,ped(info.AttackerPedHandle,attacker),info.Damage,info.ArmourDamage,Classify(info.WeaponInfo.Type),tick(),now(),critical(target)); } catch {}
        }
        void VehicleDamage(Vehicle victim,Ped attacker,VehDamageInfo info)
        {
            sensors.RecordDamageCallback("vehicle_damage");
            try { var target=vehicle(info.VehHandle,victim);var p=info.LastCollisionPosition;
                object collision=Finite(p.X)&&Finite(p.Y)&&Finite(p.Z)?new {x=p.X,y=p.Y,z=p.Z}:null;
                sensors.Damage("vehicle_damage",target,ped(info.AttackerPedHandle,attacker),info.Damage,0,Classify(info.WeaponInfo.Type),tick(),now(),critical(target),collision);
            } catch {}
        }
        static bool Finite(float n)=>!float.IsNaN(n)&&!float.IsInfinity(n)&&Math.Abs(n)<=100000;
        static string Classify(DamageType type)
        {
            // Only defined enum values can yield a classification; names are never transported.
            if(!Enum.IsDefined(typeof(DamageType),type)) return "unknown";
            switch(type.ToString().ToUpperInvariant()) {
                case "PISTOL":case "SMG":case "SHOTGUN":case "RIFLE":case "SNIPER":case "MG":case "VEHICLEFIREARM":return "bullet";
                case "UNARMED":case "MELEEBLUNT":case "MELEESTAB":return "melee";
                case "EXPLOSIVE":return "explosion";case "FIRE":return "fire";case "VEHICLE":return "collision";default:return "unknown";
            }
        }
        public void Dispose() {DamageTrackerService.OnPedTookDamage-=PedDamage;DamageTrackerService.OnPlayerTookDamage-=PlayerDamage;DamageTrackerService.OnVehicleTookDamage-=VehicleDamage;}
    }
}
