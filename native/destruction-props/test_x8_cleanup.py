"""Exercise the actual cleanup verification methods with deletion outcomes, without GTA."""
from pathlib import Path
import subprocess, tempfile
p=Path(__file__).resolve().parent
source=(p/'X8RuntimeAdapter.inc.cs').read_text()
methods=source.split('    readonly List<Entity> x8CleanupEntities',1)[1].split('    // Bounded read-only audit',1)[0]
program='''using System;
using System.Collections.Generic;
class Model { public int Hash = 1185366416; }
class Entity {
 public int Handle; public bool Alive=true; public bool Unknown; public Model Model=new Model();
 public static Dictionary<int,Entity> Pool=new Dictionary<int,Entity>();
 public bool Exists(){if(Unknown)throw new Exception("unknown native state");return Alive;}
 public static Entity FromHandle(int h){Entity e;return Pool.TryGetValue(h,out e)?e:null;}
}
class Program {
 readonly List<Entity> owned=new List<Entity>(); readonly List<int> debris=new List<int>();
 void Row(string kind,params object[] fields){}
 readonly List<Entity> x8CleanupEntities'''+methods+'''
 static void Main(){
  Program p=new Program();Entity root=new Entity{Handle=1};p.owned.Add(root);p.X8CaptureCleanup();p.owned.Clear();
  if(p.X8CleanupAbsent())throw new Exception("cleared list hid failed deletion");
  root.Alive=false;if(!p.X8CleanupAbsent()||p.x8CleanupEntities.Count!=0)throw new Exception("deleted reference not released");
  Entity child=new Entity{Handle=2};Entity.Pool[2]=child;p.debris.Add(2);p.X8CaptureCleanup();p.debris.Clear();
  if(p.X8CleanupAbsent())throw new Exception("unremoved debris accepted");
  child.Unknown=true;bool refused=false;try{p.X8CleanupAbsent();}catch{refused=true;}if(!refused)throw new Exception("unknown state accepted");
  child.Unknown=false;child.Alive=false;if(!p.X8CleanupAbsent())throw new Exception("resolved cleanup refused");
  Console.WriteLine("PASS actual X8 cleanup: surviving root, surviving debris, unknown native state, verified deletion");
 }
}
'''
with tempfile.TemporaryDirectory(prefix='x8-cleanup-') as d:
 t=Path(d);(t/'test.csproj').write_text('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>')
 (t/'NuGet.Config').write_text('<configuration><packageSources><clear /></packageSources></configuration>')
 (t/'Program.cs').write_text(program)
 subprocess.run(['dotnet','run','--project',str(t/'test.csproj'),'--configuration','Release'],check=True)
