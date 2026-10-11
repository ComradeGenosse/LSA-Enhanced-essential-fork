using System;
using LSA.Intelligence;

static class Program
{
    static int passed;
    static void Check(bool condition,string name)
    {if(!condition)throw new Exception(name);passed++;}
    static void Main()
    {
        string alias="promoted.12be3456-1234-4234-8234-123456789abc";
        string inc="abab3456-1234-4234-8234-123456789abc";
        string world="cdcd3456-1234-4234-8234-123456789abc";
        bool Match(string a,string c,string i,string ci,string w,string cw,
                   bool observer=true,bool ped=true,bool anchor=true,bool registration=true)=>
            MemoryOwnerProofPolicy.ExactOwner(a,c,i,ci,w,cw,observer,ped,anchor,registration);
        Check(Match(alias,alias,inc,inc,world,world),"exact_registration");
        Check(!Match(alias,"promoted.223e3456-1234-4234-8234-123456789abc",inc,inc,world,world),"other_character");
        Check(!Match(alias,alias,inc,"abab3456-1234-4234-8234-123456789abd",world,world),"reused_handle_new_incarnation");
        Check(!Match(alias,alias,inc,inc,world,"cdcd3456-1234-4234-8234-123456789abd"),"save_rollback_world_mismatch");
        Check(!Match(alias,alias,inc,inc,world,world,false),"missing_observer");
        Check(!Match(alias,alias,inc,inc,world,world,true,false),"retired_ped");
        Check(!Match(alias,alias,inc,inc,world,world,true,true,false),"stale_anchor");
        Check(!Match(alias,alias,inc,inc,world,world,true,true,true,false),"stale_registration");
        Check(!Match("promoted.not_a_uuid","promoted.not_a_uuid",inc,inc,world,world),"forged_alias");
        Check(MemoryOwnerProofPolicy.ProtagonistKey(0x9B22DBAFu)=="franklin","franklin_model");
        Check(MemoryOwnerProofPolicy.ProtagonistKey(0x0D7114C9u)=="michael","michael_model");
        Check(MemoryOwnerProofPolicy.ProtagonistKey(0x9B810FA2u)=="trevor","trevor_model");
        Check(MemoryOwnerProofPolicy.ProtagonistKey(0u)=="unknown","unknown_model");
        Console.WriteLine("MemoryNativePolicy: "+passed+" assertions PASS (offline pure policy; NOT GTA)");
    }
}
