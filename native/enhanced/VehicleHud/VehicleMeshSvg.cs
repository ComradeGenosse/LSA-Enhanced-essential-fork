using System;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Security;

namespace LSA.Enhanced.VehicleHud
{
    // Same pure shape used by native HUD integration and offline replay.
    // SVG export exists only for offline previews, not a web dependency.
    public static class VehicleMeshSvg
    {
        static string N(float f)=>f.ToString("0.###",CultureInfo.InvariantCulture);
        static string Escape(string s)=>SecurityElement.Escape(s??"");
        static string Points(BodyVertex[] points,float x,float y,float w,float h)
        {
            return string.Join(" ",points.Select(p=>
                N(x+(p.X+.55f)/1.1f*w)+","+N(y+p.Y*h)));
        }
        public static string Render(VehicleBodyMesh mesh,string caption)
        {
            if(mesh==null)throw new ArgumentNullException(nameof(mesh));
            float h=445f;
            float ratio=(mesh.Bounds.MaxX-mesh.Bounds.MinX)/
                (mesh.Bounds.MaxY-mesh.Bounds.MinY);
            float w=Math.Max(140f,Math.Min(230f,h*ratio));
            float x=58f+(230f-w)*.5f,y=56f;
            var b=new StringBuilder();
            b.AppendLine("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 570 560\" width=\"570\" height=\"560\">");
            b.AppendLine("<rect width=\"570\" height=\"560\" rx=\"18\" fill=\"#081720\"/>");
            b.AppendLine("<rect x=\"16\" y=\"16\" width=\"538\" height=\"526\" rx=\"12\" fill=\"none\" stroke=\"#275564\"/>");
            b.Append("<text x=\"37\" y=\"40\" fill=\"#cff8fa\" font-size=\"18\" font-family=\"Arial\">")
                .Append(Escape(mesh.Model.ToUpperInvariant())).AppendLine("</text>");
            b.Append("<polygon points=\"").Append(Points(mesh.Outline,x,y,w,h))
                .AppendLine("\" fill=\"#123e4b\" stroke=\"#63d7df\" stroke-width=\"3\" stroke-linejoin=\"round\"/>");
            b.Append("<polygon points=\"").Append(Points(mesh.Cabin,x,y,w,h))
                .AppendLine("\" fill=\"#3b7581\" fill-opacity=\".65\" stroke=\"#a5e6e8\" stroke-width=\"1.5\"/>");
            for(int i=0;i<2;i++) {
                float ty=i==0?mesh.FrontWheelY:mesh.RearWheelY;
                float cy=y+ty*h-26f;
                b.Append("<rect x=\"").Append(N(x-22f)).Append("\" y=\"").Append(N(cy)).AppendLine("\" width=\"28\" height=\"51\" rx=\"7\" fill=\"#48bac7\"/>");
                b.Append("<rect x=\"").Append(N(x+w-5f)).Append("\" y=\"").Append(N(cy)).AppendLine("\" width=\"28\" height=\"51\" rx=\"7\" fill=\"#48bac7\"/>");
            }
            b.Append("<text x=\"374\" y=\"100\" fill=\"#e8f7fa\" font-size=\"17\" font-family=\"Arial\">")
                .Append(Escape(mesh.Archetype.ToUpperInvariant())).AppendLine("</text>");
            b.Append("<text x=\"374\" y=\"126\" fill=\"#92c3cb\" font-size=\"12\" font-family=\"Arial\">")
                .Append(mesh.ExperimentalDeformation?"EXPERIMENTAL REPLAY":"ARCHETYPE OUTLINE")
                .AppendLine("</text>");
            b.Append("<text x=\"374\" y=\"168\" fill=\"#e8f7fa\" font-size=\"12\" font-family=\"Arial\">")
                .Append(Escape(caption)).AppendLine("</text>");
            b.AppendLine("<text x=\"374\" y=\"211\" fill=\"#ffc48e\" font-size=\"11\" font-family=\"Arial\">NOT GTA RENDER MESH</text>");
            b.AppendLine("<text x=\"374\" y=\"232\" fill=\"#acc4cf\" font-size=\"11\" font-family=\"Arial\">Dimensions + archetype</text>");
            b.AppendLine("<text x=\"374\" y=\"251\" fill=\"#acc4cf\" font-size=\"11\" font-family=\"Arial\">proportions only</text>");
            b.AppendLine("<text x=\"374\" y=\"292\" fill=\"#acc4cf\" font-size=\"11\" font-family=\"Arial\">FRONT AT TOP</text>");
            b.AppendLine("</svg>");
            return b.ToString();
        }
    }
}
