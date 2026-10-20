using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using Rage;

namespace LSA.AGM.E0
{
    // Optional read/yield bridge lives only in Essential's original AppDomain.
    // No code in this research plugin modifies ACT, Director or P2.
    internal sealed class EssentialDomain : IDisposable
    {
        private readonly LabEssentialProbe probe;
        public bool Available {get;private set;}
        public bool IsLoaded {get;private set;}
        public bool AbsenceProven {get;private set;}
        public bool CanYield => probe!=null && Status=="pinned_ready";
        public string Status {get;private set;}="not_loaded";
        public EssentialDomain(string folder)
        {
            try{
                string location=Path.Combine(folder,"LSA.AGM.E0.EssentialProbe.dll");
                if(!File.Exists(location)){Status="bridge_missing";return;}
                AppDomain found=null;
                LabEssentialProbe bridge=null;
                int unknown=0;
                foreach(var domain in Domains()) {
                    if(!domain.FriendlyName.StartsWith("PreInitializedDomain_",StringComparison.Ordinal)
                        && domain.FriendlyName!="LosSantosAlive_AppDomain")continue;
                    try{
                        var temp=(LabEssentialProbe)domain.CreateInstanceFromAndUnwrap(location,typeof(LabEssentialProbe).FullName);
                        var core=temp.CoreStatus;
                        if(core=="core_missing")continue;
                        if(core=="core_ambiguous"){unknown++;continue;}
                        IsLoaded=true;
                        if(core!="core_ready"){Status=core;return;}
                        if(found!=null){Status="essential_domain_ambiguous";return;}
                        found=domain;bridge=temp;
                    }catch{unknown++;}
                }
                probe=bridge;
                if(probe!=null){Available=true;Status=probe.Start()?"pinned_ready":"start_rejected";}
                else if(Status=="not_loaded"){
                    AbsenceProven=unknown==0;
                    Status=AbsenceProven?"essential_absent_verified":"essential_presence_unresolved";
                }
            }catch(Exception e){Status="bridge_error_"+e.GetType().Name;}
        }
        public bool Yield(int handle,long address,uint model,bool enable)
        {
            if(!CanYield)return false;
            try{
                if(!probe.RequestYield(handle,address,model,enable))return false;
                var expected=enable?"yield_on":"yield_off";
                for(int i=0;i<40;i++){
                    var result=probe.Applied(handle);
                    if(result==expected)return true;
                    if(result!="pending")return false;
                    GameFiber.Sleep(25);
                }
                return false;
            }catch{Status="bridge_disconnected";return false;}
        }
        public bool Observe(int handle,long address,uint model)
        {
            if(!CanYield)return false;
            try{return probe.RequestObserve(handle,address,model);}catch{return false;}
        }
        public void Forget(int handle,long address,uint model)
        {
            if(!CanYield)return;
            try{probe.ForgetObserved(handle,address,model);}catch{}
        }
        public string Snapshot(int handle)
        {
            if(!CanYield)return Status;
            try{return probe.GetSnapshot(handle);}catch{return "snapshot_unavailable";}
        }
        public void Dispose() {try{probe?.Stop();}catch{}}
        // CLR enumeration matches promoted-characters' read-only domain
        // discovery; never load Essential into the lab loader's domain.
        private static List<AppDomain> Domains()
        {
            var host=(ICorRuntimeHost)RuntimeEnvironment.GetRuntimeInterfaceAsObject(
                new Guid("CB2F6723-AB3A-11D2-9C40-00C04FA30A3E"),
                new Guid("CB2F6722-AB3A-11D2-9C40-00C04FA30A3E"));
            IntPtr enumeration=IntPtr.Zero;
            var list=new List<AppDomain>();
            try{
                host.EnumDomains(out enumeration);
                for(int i=0;i<128;i++){
                    object domain;
                    int status=host.NextDomain(enumeration,out domain);
                    if(status==1||domain==null)break;
                    if(status!=0)Marshal.ThrowExceptionForHR(status);
                    list.Add((AppDomain)domain);
                }
                return list;
            }finally{
                if(enumeration!=IntPtr.Zero)host.CloseEnum(enumeration);
                Marshal.ReleaseComObject(host);
            }
        }
        [ComImport,Guid("CB2F6722-AB3A-11D2-9C40-00C04FA30A3E"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface ICorRuntimeHost
        {
            void CreateLogicalThreadState(); void DeleteLogicalThreadState();
            void SwitchInLogicalThreadState(IntPtr state); void SwitchOutLogicalThreadState(out IntPtr state);
            void LocksHeldByLogicalThread(out uint count); void MapFile(IntPtr file,out IntPtr module);
            void GetConfiguration(out IntPtr configuration); void Start(); void Stop();
            void CreateDomain([MarshalAs(UnmanagedType.LPWStr)]string name,IntPtr identity,[MarshalAs(UnmanagedType.IUnknown)]out object domain);
            void GetDefaultDomain([MarshalAs(UnmanagedType.IUnknown)]out object domain);
            void EnumDomains(out IntPtr enumeration);
            [PreserveSig]int NextDomain(IntPtr enumeration,[MarshalAs(UnmanagedType.IUnknown)]out object domain);
            void CloseEnum(IntPtr enumeration);
        }
    }
}