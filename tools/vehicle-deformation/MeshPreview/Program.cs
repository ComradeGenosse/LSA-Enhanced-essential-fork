using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using LSA.Enhanced.VehicleHud;

internal static class Program
{
    static int Main(string[] args)
    {
        try {
            if(args.Length==0 || args[0]=="demo") {
                string output=args.Length>1?args[1]:"vh3-mesh-preview";
                Demo(output);
                return 0;
            }
            if(args.Length==4 && args[0]=="replay") {
                var baseline=Load(args[1],"baseline");
                var damaged=Load(args[2],"damaged");
                var mesh=VehicleMeshGeometry.Build(baseline.Model,baseline.Bounds);
                var deformed=VehicleMeshGeometry.Deform(mesh,baseline,damaged);
                Directory.CreateDirectory(args[3]);
                File.WriteAllText(Path.Combine(args[3],"baseline.svg"),
                    VehicleMeshSvg.Render(mesh,"Captured baseline"));
                File.WriteAllText(Path.Combine(args[3],"deformed.svg"),
                    VehicleMeshSvg.Render(deformed,deformed.ExperimentalDeformation
                        ?"Measured offset prototype":"Insufficient valid change"));
                Console.WriteLine("Saved baseline.svg and deformed.svg; change applied="+
                    deformed.ExperimentalDeformation);
                return 0;
            }
            Console.Error.WriteLine("Usage: dotnet run --project tools/vehicle-deformation/MeshPreview -- demo [output-folder]");
            Console.Error.WriteLine("       dotnet run --project tools/vehicle-deformation/MeshPreview -- replay baseline.csv damaged.csv output-folder");
            return 2;
        } catch(Exception e) {
            Console.Error.WriteLine("VH3 mesh preview failed: "+e.Message);
            return 1;
        }
    }
    static void Demo(string output)
    {
        Directory.CreateDirectory(output);
        var examples=new[]{
            new { Name="adder",Bounds=new DeformationBounds(-.96f,-2.35f,-.20f,.96f,2.35f,1.06f)},
            new { Name="elegy2",Bounds=new DeformationBounds(-.91f,-2.36f,-.22f,.91f,2.36f,1.25f)},
            new { Name="sultan",Bounds=new DeformationBounds(-.92f,-2.38f,-.18f,.92f,2.38f,1.45f)},
            new { Name="dominator",Bounds=new DeformationBounds(-.96f,-2.5f,-.17f,.96f,2.5f,1.36f)},
            new { Name="dubsta",Bounds=new DeformationBounds(-1.02f,-2.45f,-.22f,1.02f,2.45f,2.06f)},
            new { Name="bison",Bounds=new DeformationBounds(-1.02f,-2.67f,-.26f,1.02f,2.67f,1.96f)},
            new { Name="speedo",Bounds=new DeformationBounds(-1.04f,-2.55f,-.25f,1.04f,2.55f,2.45f)}
        };
        foreach(var x in examples) {
            var mesh=VehicleMeshGeometry.Build(x.Name,x.Bounds);
            if(mesh==null)throw new InvalidOperationException("Failed profile "+x.Name);
            File.WriteAllText(Path.Combine(output,x.Name+"-clean.svg"),
                VehicleMeshSvg.Render(mesh,"Prototype, undamaged"));
            foreach(string impact in new[]{"frontleft","sideleft","rear"}) {
                var a=Capture("baseline",x.Name,x.Bounds,impact);
                var b=Capture("damaged",x.Name,x.Bounds,impact);
                var deformed=VehicleMeshGeometry.Deform(mesh,a,b);
                if(!deformed.ExperimentalDeformation)
                    throw new InvalidOperationException("Synthetic replay rejected: "+x.Name+" "+impact);
                File.WriteAllText(Path.Combine(output,x.Name+"-"+impact+".svg"),
                    VehicleMeshSvg.Render(deformed,"SIMULATED "+impact));
            }
        }
        Console.WriteLine("Produced "+(examples.Length*4)+" SVG prototypes at "+Path.GetFullPath(output));
    }
    static DeformationCapture Capture(string phase,string model,DeformationBounds bounds,string impact)
    {
        var result=new DeformationCapture("demo_"+model,phase,model,42,
            "2026-10-25T00:00:00Z",bounds,1000,phase=="baseline"?1000:720);
        while(!result.Complete) {
            var p=result.Next;
            bool hit=impact=="frontleft" ? p.Region=="front" && p.X<0 :
                impact=="sideleft" ? p.Region=="left" && Math.Abs(p.Y)<1.5f :
                p.Region=="rear";
            // These are intentionally SYNTHETIC impact fields, not observed GTA.
            float dx=phase=="damaged" && hit ? .21f : 0f;
            float dy=phase=="damaged"&&hit ? (impact=="rear" ? .26f : -.25f) :0f;
            result.Record(dx,dy,0);
        }
        return result;
    }
    // Parses our own bounded VH3 exporter, no input beyond 48 expected rows.
    static DeformationCapture Load(string path,string phase)
    {
        var lines=File.ReadAllLines(path);
        if(lines.Length!=49)throw new InvalidDataException("Exactly 48 probe rows required");
        var first=Csv(lines[1]);
        if(first.Length!=24 || first[2]!=phase)throw new InvalidDataException("Wrong capture phase/format");
        float F(string s) => float.Parse(s,CultureInfo.InvariantCulture);
        int handle=int.Parse(first[4],CultureInfo.InvariantCulture);
        var bounds=new DeformationBounds(F(first[7]),F(first[8]),F(first[9]),
            F(first[10]),F(first[11]),F(first[12]));
        var cap=new DeformationCapture(first[1],phase,first[3],handle,first[0],
            bounds,F(first[5]),F(first[6]));
        for(int i=0;i<48;i++) {
            var row=Csv(lines[i+1]);
            if(row.Length!=24 || row[1]!=cap.CaptureId || row[2]!=phase ||
                row[3]!=cap.Model || row[4]!=first[4] ||
                row[13]!=i.ToString(CultureInfo.InvariantCulture) ||
                row[14]!=cap.Next.Region)
                throw new InvalidDataException("Mismatched probe row "+i);
            float dx= row[22]=="1"?F(row[18]):float.NaN;
            float dy= row[22]=="1"?F(row[19]):float.NaN;
            float dz= row[22]=="1"?F(row[20]):float.NaN;
            float px=F(row[15]),py=F(row[16]),pz=F(row[17]);
            if(Math.Abs(px-cap.Next.X)>.001f ||Math.Abs(py-cap.Next.Y)>.001f||
                Math.Abs(pz-cap.Next.Z)>.001f)
                throw new InvalidDataException("Probe coordinates changed");
            cap.Record(dx,dy,dz,row[22]=="1"?null:row[23]);
        }
        return cap;
    }
    static string[] Csv(string line)
    {
        var fields=new List<string>();
        var current=new StringBuilder();
        bool quoted=false;
        for(int i=0;i<line.Length;i++) {
            char c=line[i];
            if(c=='"') {
                if(quoted && i+1<line.Length && line[i+1]=='"') {current.Append('"');i++;}
                else quoted=!quoted;
            } else if(c==',' && !quoted) {fields.Add(current.ToString());current.Clear();}
            else current.Append(c);
        }
        if(quoted)throw new InvalidDataException("Unterminated CSV field");
        fields.Add(current.ToString());
        return fields.ToArray();
    }
}
