"""Compile actual request/lifecycle methods with offline stubs, never load GTA."""
from pathlib import Path
import subprocess
import tempfile
import json

SOURCE = Path(__file__).resolve().parents[2] / 'native/fragment-x7/WpsBreachLabX7.3.cs'

def method(source, name):
    start=source.index('    '+name)
    opening=source.index('{',start)
    # These methods have balanced braces even inside their strings.
    level=1; end=opening+1
    while level:
        level += (source[end]=='{') - (source[end]=='}'); end+=1
    return source[start:end]

def main():
    source=SOURCE.read_text()
    methods='\n'.join(method(source,n) for n in ['bool AcceptRequest(', 'static bool IsToken(', 'void Respond(', 'static void AtomicText(', 'void OnTick(', 'void Row('])
    stub=r'''
using System; using System.IO; using System.Diagnostics; using System.Text; using System.Collections.Generic; using System.Globalization; using System.Text.Json;
static class Game { public static int FrameCount=1; }
class Program {
const string Ver="offline";
string lab, scriptSha=new string('a',64), shvdnVer="stub", runDir, runId, state="IDLE", step="", curCmd="", requestId, fence, sessionId, experimentId, trialId, commandError;
Stopwatch clock=Stopwatch.StartNew();
DateTime loadedUtc=DateTime.UtcNow; bool busy,abortRequested,commandFailed,x4Active=false; string x7State="None"; StreamWriter rows,frameLog; static CultureInfo Inv=CultureInfo.InvariantCulture; int executions;
void Beat(bool force=false) {} void CleanupAll() {} void RestorePlayer() {} string SafeGameVersion(){return "stub";} string AutoLoadSetting(){return "stub";} object PoolsRaw(){return null;}
static object Arr(string[] x){return x;} static string Trim(string x,int n){return x;}
static string Obj(params object[] kv){ var d=new Dictionary<string,object>(); for(int i=0;i<kv.Length;i+=2)d[(string)kv[i]]=kv[i+1];return JsonSerializer.Serialize(d); }

void RunCommand(string line){executions++;if(line=="throw")throw new Exception("injected");if(line=="abort")abortRequested=true;if(line.StartsWith("row:"))Row(line.Substring(4));}
string[] Wire(string cmd){return new[]{"X7P2",Guid.NewGuid().ToString("N"),new string('b',32),"session","experiment","trial",Process.GetCurrentProcess().Id.ToString(),loadedUtc.ToString("o"),scriptSha,((long)(DateTime.UtcNow-new DateTime(1970,1,1)).TotalSeconds+60).ToString(),cmd};}
void Check(bool value,string why){if(!value)throw new Exception(why);}
void Execute(string[] w){File.WriteAllLines(Path.Combine(lab,"request.txt"),w); OnTick();}
void Test(){
Directory.CreateDirectory(lab); File.WriteAllText(Path.Combine(lab,"controller.fence"),new string('b',32));
var good=Wire("ok");Execute(good);Check(state=="DONE" && executions==1,"success");
Execute(good);Check(executions==1,"duplicate replay");
var thrown=Wire("throw");Execute(thrown);Check(state=="ERROR" && executions==2,"exception falsely successful");
using(var doc=JsonDocument.Parse(File.ReadAllText(Path.Combine(lab,"responses",thrown[1]+".json"))))Check(doc.RootElement.GetProperty("state").GetString()=="ERROR","response exception");
Execute(Wire("abort"));Check(state=="ERROR","abort falsely successful");
foreach(string kind in new[]{"error","exception","refused","unknown_command","frame_log_error"}){Execute(Wire("row:"+kind));Check(state=="ERROR","row falsely successful: "+kind);}
int before=executions;
var stale=Wire("ok");stale[9]="1";Execute(stale);Check(state=="REJECTED" && executions==before,"expiry");
var reload=Wire("ok");reload[7]="old-loaded-utc";Execute(reload);Check(executions==before,"reload same pid");
var wrong=Wire("ok");wrong[8]=new string('c',64);Execute(wrong);Check(executions==before,"loaded sha");
var owner=Wire("ok");owner[2]=new string('c',32);Execute(owner);Check(executions==before,"wrong fence");
var partial=Wire("ok");Array.Resize(ref partial,5);Execute(partial);Check(executions==before,"partial envelope");
var interrupted=Wire("ok");Directory.CreateDirectory(Path.Combine(lab,"claims"));File.WriteAllText(Path.Combine(lab,"claims",interrupted[1]),"claimed before crash");Execute(interrupted);Check(state=="REJECTED" && executions==before,"interrupted replay");
File.WriteAllText(Path.Combine(lab,"command.txt"),"throw");OnTick();Check(executions==before,"legacy executed");
Console.WriteLine("PASS: 16 actual C# protocol/lifecycle scenarios (offline stubs)");
}
static void Main(string[] args){new Program{lab=args[0]}.Test();}
}
'''
    with tempfile.TemporaryDirectory(prefix='x7-protocol-csharp-') as temp:
        root=Path(temp)
        (root/'NuGet.Config').write_text('<configuration><packageSources><clear /></packageSources></configuration>')
        (root/'test.csproj').write_text('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><EnableNETAnalyzers>false</EnableNETAnalyzers></PropertyGroup></Project>')
        (root/'Program.cs').write_text(stub.replace('static void Main',methods+'\nstatic void Main'))
        subprocess.run(['dotnet','build','--configfile',str(root/'NuGet.Config'),'-v','q'],cwd=root,check=True)
        subprocess.run(['dotnet',str(root/'bin/Debug/net10.0/test.dll'),str(root/'lab')],check=True)

if __name__=='__main__': main()
