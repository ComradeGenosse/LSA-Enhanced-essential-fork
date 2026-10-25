using System;
using System.Linq;
using LSA.Enhanced.VehicleHud;

static partial class Program
{
    static void VehicleMeshTests()
    {
        var bounds=new DeformationBounds(-1f,-2.5f,-.2f,1f,2.5f,1.4f);
        var car=VehicleMeshGeometry.Build("adder",bounds);
        var other=VehicleMeshGeometry.Build("zentorno",bounds);
        Check(car!=null && other!=null && car.Outline.Length==26 &&
            car.Cabin.Length==4 && car.Archetype=="supercar",
            "named vehicles produce stable top-down body meshes");
        Check(Math.Abs(car.Outline[0].X-other.Outline[0].X)>.01f,
            "different stock models can have distinct hand-tuned noses");
        Check(VehicleMeshGeometry.Build("bison",bounds).Archetype=="pickup" &&
            VehicleMeshGeometry.Build("speedo",bounds).Archetype=="van" &&
            VehicleMeshGeometry.Build("dominator",bounds).Archetype=="muscle" &&
            VehicleMeshGeometry.Build("elegy2",bounds).Archetype=="coupe" &&
            VehicleMeshGeometry.Build("sultan",bounds).Archetype=="sedan" &&
            VehicleMeshGeometry.Build("dubsta",bounds).Archetype=="suv",
            "six archetypes plus the supercar profile supported");
        Check(VehicleMeshGeometry.Build("unknown-mod-car",bounds).Archetype=="sedan" &&
            VehicleMeshGeometry.Build("unknown-mod-car",
                new DeformationBounds(-1,-3,-.2f,1,3,2.2f)).Archetype=="suv",
            "unknown addon vehicles fall back to model dimension heuristics");
        Check(VehicleMeshGeometry.Build("adder",
            new DeformationBounds(0,0,0,0,0,0)) == null,
            "invalid bounds do not produce a fake vehicle silhouette");
        var baseline=new DeformationCapture("pair_1","baseline","adder",42,
            "2026-10-25T19:00:00Z",bounds,1000,1000);
        var damaged=new DeformationCapture("pair_1","damaged","adder",42,
            "2026-10-25T19:00:05Z",bounds,1000,780);
        while(!baseline.Complete) {
            var p=baseline.Next;
            bool hit=p.Region=="front" && p.X<0;
            baseline.Record(0,0,0);
            damaged.Record(hit ? .22f : 0,hit?-.24f:0,0);
        }
        var changed=VehicleMeshGeometry.Deform(car,baseline,damaged);
        Check(changed.ExperimentalDeformation &&
            changed.Outline[0].X > car.Outline[0].X &&
            changed.Outline[0].Y > car.Outline[0].Y,
            "front-left simulated crush deforms nearby actual body-outline vertices");
        Check(Math.Abs(changed.Outline[12].X-car.Outline[12].X)<.001f &&
            Math.Abs(changed.Outline[12].Y-car.Outline[12].Y)<.001f,
            "front impact does not distort rear body vertices");
        Check(changed.Outline.All(v=>!float.IsNaN(v.X) && !float.IsNaN(v.Y) &&
            Math.Abs(v.X)<=.54f && v.Y>=0 && v.Y<=1),
            "displacement is bounded and finite");
        var unchanged=new DeformationCapture("pair_1","damaged","adder",42,
            "2026-10-25T19:00:05Z",bounds,1000,700);
        while(!unchanged.Complete)unchanged.Record(0,0,0);
        Check(!VehicleMeshGeometry.Deform(car,baseline,unchanged).ExperimentalDeformation,
            "body-health damage alone never invents geometric distortion");
        var wrong=new DeformationCapture("different","damaged","adder",42,
            "2026-10-25T19:00:05Z",bounds,1000,700);
        while(!wrong.Complete)wrong.Record(.2f,-.2f,0);
        Check(!VehicleMeshGeometry.Deform(car,baseline,wrong).ExperimentalDeformation,
            "unpaired capture IDs fail closed even with plausible vectors");
        var missing=new DeformationCapture("pair_1","damaged","adder",42,
            "2026-10-25T19:00:05Z",bounds,1000,700);
        while(!missing.Complete)missing.Record(float.NaN,float.NaN,float.NaN);
        Check(!VehicleMeshGeometry.Deform(car,baseline,missing).ExperimentalDeformation,
            "unsupported native reads never deform the silhouette");
        var svg=VehicleMeshSvg.Render(changed,"SIMULATED impact");
        Check(svg.Contains("<polygon") && svg.Contains("SIMULATED impact") &&
            svg.Contains("NOT GTA RENDER MESH") && !svg.Contains("NaN"),
            "pure offline SVG generator renders a readable labeled deformable mesh");
    }
}
