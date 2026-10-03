using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace LSA.PromotedCharacters
{
    internal static class ClrDomains
    {
        // Read-only CLR enumeration; never create, stop, or unload a domain.
        public static AppDomain FindEssential(string bootstrap)
        {
            return FindUnique(domain=>{
                if(!domain.FriendlyName.StartsWith("PreInitializedDomain_",StringComparison.Ordinal) && domain.FriendlyName!="LosSantosAlive_AppDomain") return false;
                try {
                    // Only the command-free bootstrap crosses domains. Loading
                    // the plugin here exposes its command definitions again.
                    var probe=(DomainHost)domain.CreateInstanceFromAndUnwrap(bootstrap,typeof(DomainHost).FullName);
                    return probe.CoreStatus=="core_ready";
                } catch {return false;}
            });
        }
        internal static AppDomain FindUnique(Func<AppDomain,bool> matches)
        {
            AppDomain result=null;
            foreach(var domain in Enumerate()) {
                if(!matches(domain)) continue;
                if(result!=null) return null;
                result=domain;
            }
            return result;
        }
        internal static List<AppDomain> Enumerate()
        {
            var host=(ICorRuntimeHost)RuntimeEnvironment.GetRuntimeInterfaceAsObject(new Guid("CB2F6723-AB3A-11D2-9C40-00C04FA30A3E"),new Guid("CB2F6722-AB3A-11D2-9C40-00C04FA30A3E"));
            IntPtr enumeration=IntPtr.Zero;
            var domains=new List<AppDomain>();
            try {
                host.EnumDomains(out enumeration);
                for(int count=0;count<128;count++) {
                    int status=host.NextDomain(enumeration,out var domain);
                    if(status==1 || domain==null) break;
                    if(status!=0) Marshal.ThrowExceptionForHR(status);
                    domains.Add((AppDomain)domain);
                }
                return domains;
            } finally {if(enumeration!=IntPtr.Zero) host.CloseEnum(enumeration); Marshal.ReleaseComObject(host);}
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
