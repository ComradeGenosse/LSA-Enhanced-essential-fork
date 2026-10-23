"""Compile and exercise the actual X8 ownership verifier without GTA.

The fixture mirrors the captured e2505be4 outcome: three non-owned
debris candidates survived X3's deliberate ambient-safety skip.
"""
from pathlib import Path
import subprocess
import tempfile

here = Path(__file__).resolve().parent
source = (here / "X8RuntimeAdapter.inc.cs").read_text(encoding="utf-8")
assert source.count("    readonly List<Entity> x8CleanupEntities") == 1
methods = source.split("    readonly List<Entity> x8CleanupEntities", 1)[1].split(
    "    // Bounded read-only audit", 1
)[0]
program = r'''using System;
using System.Collections.Generic;
class Model { public int Hash = 1185366416; }
class Entity {
    public int Handle;
    public bool Alive = true, Unknown;
    public Model Model = new Model();
    public static Dictionary<int,Entity> Pool = new Dictionary<int,Entity>();
    public bool Exists() {
        if (Unknown) throw new Exception("unknown native state");
        return Alive;
    }
    public static Entity FromHandle(int h) {
        Entity e; return Pool.TryGetValue(h, out e) ? e : null;
    }
}
class Program {
    readonly List<Entity> owned = new List<Entity>();
    readonly HashSet<int> debris = new HashSet<int>();
    readonly HashSet<int> flaggedSet = new HashSet<int>();
    readonly Dictionary<int,int> debrisOwner = new Dictionary<int,int>();
    readonly HashSet<int> verifiedNow = new HashSet<int>();
    bool IsVerifiedLabDebris(int h) { return verifiedNow.Contains(h); }
    void Row(string kind, params object[] fields) {}
    readonly List<Entity> x8CleanupEntities''' + methods + r'''
    static void Check(bool condition, string name) {
        if (!condition) throw new Exception(name);
    }
    static void Main() {
        // Actual lab-created root remains: cleanup MUST refuse.
        Program ownedCase = new Program();
        Entity root = new Entity{Handle=1};
        ownedCase.owned.Add(root); ownedCase.X8CaptureCleanup();
        ownedCase.owned.Clear();
        Check(!ownedCase.X8CleanupAbsent(), "surviving root accepted");
        root.Alive = false;
        Check(ownedCase.X8CleanupAbsent(), "deleted root refused");
        Check(ownedCase.x8CleanupEntities.Count == 0, "root witnesses not released");

        // Three exact-type X3 ambient/unproven candidates survive deletion;
        // they must remain in GTA, but must NOT count as owned-root leaks.
        Program observed = new Program();
        for (int i = 0; i < 15; i++) {
            Entity e = new Entity{Handle=100+i, Alive=false};
            observed.owned.Add(e);
        }
        for (int i = 0; i < 3; i++) {
            Entity ambient = new Entity{Handle=300+i};
            Entity.Pool[ambient.Handle] = ambient;
            observed.debris.Add(ambient.Handle);
        }
        observed.X8CaptureCleanup();
        Check(observed.x8CleanupEntities.Count == 15, "wrong tracked-owned total");
        Check(observed.x8CleanupUnverified == 3, "did not observe three unverified candidates");
        observed.owned.Clear(); observed.debris.Clear();
        Check(observed.X8CleanupAbsent(), "unverified ambient props caused false failure");
        for (int i = 0; i < 3; i++)
            Check(Entity.Pool[300+i].Alive, "ambient entity was deleted");

        // Parent-linked evidence captured earlier must stay owned even when
        // live detach metadata disappears before cleanup.
        Program flagged = new Program();
        Entity child = new Entity{Handle=2};
        Entity.Pool[2] = child;
        flagged.debris.Add(2); flagged.flaggedSet.Add(2);
        flagged.debrisOwner[2] = 0; flagged.X8CaptureCleanup();
        flagged.debris.Clear();
        Check(!flagged.X8CleanupAbsent(), "proven native debris accepted");
        child.Alive = false;
        Check(flagged.X8CleanupAbsent(), "deleted native debris refused");

        // Current detached-parent evidence is also sufficient.
        Program native = new Program();
        Entity detached = new Entity{Handle=3}; Entity.Pool[3] = detached;
        native.debris.Add(3); native.verifiedNow.Add(3);
        native.X8CaptureCleanup();
        Check(!native.X8CleanupAbsent(), "currently verified debris accepted");
        detached.Alive = false;
        Check(native.X8CleanupAbsent(), "deleted verified debris refused");

        // Reused handle with a different model must not be mistaken for
        // an undeleted owned entity.
        Program reused = new Program();
        Entity old = new Entity{Handle=4}; reused.owned.Add(old);
        reused.X8CaptureCleanup(); reused.owned.Clear();
        old.Model.Hash = 777;
        Check(reused.X8CleanupAbsent(), "recycled handle wrongly blocked restore");

        // Unknown/native error is not permission to declare cleanup complete.
        Program unknown = new Program();
        Entity uncertain = new Entity{Handle=5}; unknown.owned.Add(uncertain);
        unknown.X8CaptureCleanup(); uncertain.Unknown = true;
        bool refused = false;
        try { unknown.X8CleanupAbsent(); } catch { refused = true; }
        Check(refused && unknown.x8CleanupEntities.Count == 1, "unknown state passed");

        Console.WriteLine("PASS actual X8 ownership cleanup: surviving roots, verified debris, three unverified candidates, reused handles, unknown state");
    }
}
'''
with tempfile.TemporaryDirectory(prefix="x8-cleanup-") as d:
    tmp = Path(d)
    (tmp / "test.csproj").write_text(
        '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
        '<OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework>'
        '</PropertyGroup></Project>', encoding="utf-8"
    )
    (tmp / "NuGet.Config").write_text(
        '<configuration><packageSources><clear /></packageSources></configuration>',
        encoding="utf-8"
    )
    (tmp / "Program.cs").write_text(program, encoding="utf-8")
    subprocess.run(
        ["dotnet", "run", "--project", str(tmp / "test.csproj"),
         "--configuration", "Release"], check=True
    )
