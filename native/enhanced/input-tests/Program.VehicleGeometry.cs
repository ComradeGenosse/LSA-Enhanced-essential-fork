using System;
using System.Linq;
using LSA.Enhanced.VehicleHud;

static partial class Program
{
    static void VehicleGeometryTests()
    {
        // Synthetic contour fixture only. No Rockstar-derived vertices are
        // stored, shipped, embedded in tests, or used in CI.
        const string fixture=@"{
          ""schemaVersion"":""vh6.vehicle-geometry.v1"",
          ""model"":""buffalo"",
          ""coordinateSystem"":{
            ""gtaFront"":""+Y"",
            ""hudConvention"":""front=normalized Y 0; rear=normalized Y 1; left=negative X""
          },
          ""dimensions"":{""width"":2.0,""length"":5.0},
          ""contour"":{""vertices"":[
            {""id"":""a"",""x"":-.34,""y"":0.0},
            {""id"":""b"",""x"":-.48,""y"":.20},
            {""id"":""c"",""x"":-.48,""y"":.75},
            {""id"":""d"",""x"":-.34,""y"":1.0},
            {""id"":""e"",""x"":.34,""y"":1.0},
            {""id"":""f"",""x"":.48,""y"":.75},
            {""id"":""g"",""x"":.48,""y"":.20},
            {""id"":""h"",""x"":.34,""y"":0.0}
          ]},
          ""windowRegions"":{""rings"":[[
            {""id"":""w0"",""x"":-.28,""y"":.34},
            {""id"":""w1"",""x"":-.28,""y"":.65},
            {""id"":""w2"",""x"":.28,""y"":.65},
            {""id"":""w3"",""x"":.28,""y"":.34}
          ]]},
          ""wheels"":{
            ""lf"":{""hudNormalized"":{""x"":-.49,""y"":.24}},
            ""rf"":{""hudNormalized"":{""x"":.49,""y"":.24}},
            ""lr"":{""hudNormalized"":{""x"":-.49,""y"":.77}},
            ""rr"":{""hudNormalized"":{""x"":.49,""y"":.77}}
          },
          ""validation"":{""contourSelfIntersection"":false}
        }";
        var bounds=new DeformationBounds(-1,-2.5f,-.25f,1,2.5f,1.45f);
        VehicleGeometryProfile profile;
        string reason;
        Check(VehicleGeometryProfile.TryParse(fixture,"BUFFALO",bounds,out profile,out reason)
            && profile!=null && reason=="ok" && profile.Contour.Length==8
            && profile.Glass.Length==1 && profile.Wheels.Length==4,
            "local VH6 synthetic profile loads, preserving outline, windows and four named wheels");
        var mesh=profile.ToMesh(bounds);
        Check(mesh.ExtractedGeometry && mesh.GlassRings.Length==1 &&
            mesh.Cabin.Length==0 && Math.Abs(mesh.DisplayAspect-.4f)<.0001f,
            "extracted shape carries genuine geometry rendering switches and aspect ratio");
        Check(VehicleMeshGeometry.PolygonSafe(mesh.Outline) &&
            !VehicleMeshGeometry.PolygonSafe(new [] {
                new BodyVertex(-.4f,0),new BodyVertex(.4f,1),
                new BodyVertex(-.4f,1),new BodyVertex(.4f,0)}),
            "general polygon validator accepts cyclic mesh but rejects crossing edges");
        var a=new DeformationCapture("local","baseline","buffalo",66,"utc",bounds,1000,1000);
        var b=new DeformationCapture("local","damaged","buffalo",66,"utc",bounds,850,650);
        while(!a.Complete) {
            var point=a.Next;
            a.Record(0,0,0);
            bool hit=point.Region=="front"&&point.X<0;
            b.Record(hit ? .14f : 0f,hit ? -.15f : 0f,0f);
        }
        var distorted=VehicleMeshGeometry.Deform(mesh,a,b);
        Check(distorted.ExperimentalDeformation && distorted.ExtractedGeometry &&
            distorted.Outline.Length==8 && distorted.GlassRings.Length==1,
            "real-contour deformation retains original cyclic topology and window rings");
        var blended=VehicleMeshGeometry.Blend(mesh,distorted,.5f);
        Check(blended.GlassRings.Length==1 && blended.WheelCenters.Length==4 &&
            blended.ExtractedGeometry && blended.Outline.Length==8,
            "live interpolation preserves authentic profile metadata and glass");
        VehicleGeometryProfile reject;
        string bad;
        Check(!VehicleGeometryProfile.TryParse(fixture,"adder",bounds,out reject,out bad)
            && bad=="model_mismatch",
            "wrong-model geometry fails closed");
        Check(!VehicleGeometryProfile.TryParse(fixture,"buffalo",
            new DeformationBounds(-1,-6,-.25f,1,6,1.45f),out reject,out bad)
            && bad=="bounds_disagree",
            "unrelated runtime dimensions never load a misleading local outline");
        Check(!VehicleGeometryProfile.TryParse(fixture.Replace(
                "front=normalized Y 0; rear=normalized Y 1; left=negative X",
                "front=normalized Y 1; rear=normalized Y 0; left=negative X"),
            "buffalo",bounds,out reject,out bad) &&
            bad=="coordinate_system_mismatch",
            "wrong axis handedness is rejected");
    }
}
