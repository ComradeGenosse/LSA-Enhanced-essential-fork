using System;
namespace Rage {
    public class Ped {public uint Handle=>throw new Exception("Callback must not access entity");}
    public class Vehicle {public uint Handle=>throw new Exception("Callback must not access entity");}
    public struct Vector3 {public float X,Y,Z;}
}
namespace DamageTrackerLib.DamageInfo {
    public enum DamageType {Unknown,Pistol,MeleeBlunt,Explosive,Fire,Vehicle,LessThanLethal}
    public struct WeaponDamageInfo {public DamageType Type;}
    public struct PedDamageInfo {public uint PedHandle,AttackerPedHandle;public int Damage,ArmourDamage;public WeaponDamageInfo WeaponInfo;}
    public struct VehDamageInfo {public uint VehHandle,AttackerPedHandle;public int Damage;public WeaponDamageInfo WeaponInfo;public Rage.Vector3 LastCollisionPosition;}
}
namespace DamageTrackerLib {
    public static class DamageTrackerService {
        public delegate void PedTookDamageDelegate(Rage.Ped victim,Rage.Ped attacker,DamageInfo.PedDamageInfo info);
        public delegate void VehTookDamageDelegate(Rage.Vehicle victim,Rage.Ped attacker,DamageInfo.VehDamageInfo info);
        public static event PedTookDamageDelegate OnPedTookDamage,OnPlayerTookDamage;
        public static event VehTookDamageDelegate OnVehicleTookDamage;
        public static bool IsRunning {get;set;}=true;
        public static int StartCalls,StopCalls;
        public static void Start() {StartCalls++;throw new Exception();}
        public static void Stop() {StopCalls++;throw new Exception();}
        public static void Ped(DamageInfo.PedDamageInfo info,bool player=false) {if(player) OnPlayerTookDamage?.Invoke(new Rage.Ped(),new Rage.Ped(),info);else OnPedTookDamage?.Invoke(new Rage.Ped(),new Rage.Ped(),info);}
        public static void Vehicle(DamageInfo.VehDamageInfo info) {OnVehicleTookDamage?.Invoke(new Rage.Vehicle(),new Rage.Ped(),info);}
    }
}
