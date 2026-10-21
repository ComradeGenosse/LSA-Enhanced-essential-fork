"""Build X6 as a small, asserted transformation of the frozen X5 driver."""
from pathlib import Path
p=Path(__file__).parent
s=(p.parent/'fragment-x5/WpsBreachLabX5.3.cs').read_text(encoding='utf-8')
for a,b in [('X5','X6'),('x5','x6'),('lsa_x2_concrete','lsa_x6_corrugated')]:s=s.replace(a,b)
def replace(a,b):
 global s
 assert s.count(a)==1,(a,s.count(a))
 s=s.replace(a,b)
replace('Math.Abs(width - 3f) > .8f || Math.Abs(height - 2.5f) > .45f) throw new Exception("target_size_requires_asset_adaptation");\n        if (Vector3.Dot(target.UpVector', 'Math.Abs(width - 2.536f) > .08f || Math.Abs(height - 2.351f) > .08f) throw new Exception("target_size_requires_asset_adaptation");\n        if (Vector3.Dot(target.UpVector')
replace('                seen = true;\n                trace.Add(new X6Frame', '                gone = false; goneFrame = -1; // Reacquisition cancels a transient tracking gap.\n                seen = true;\n                trace.Add(new X6Frame')
replace('case "x6cam": X6Cam(a); break;','case "x6cam": X6Cam(a); break;\n            case "x6preview": if (x6State != "Armed") throw new Exception("x6prepare_required"); X6Commit(); x6State = "Active"; Row("x6_preview", "diagnosticOnly", true); break;')
replace('        if (x6Orig != null)\n        {\n            int w = X6Witness', '''        // Model hide invalidates the original handle. Reacquire before restore witness (X5 limitation).
        Prop restored = null; float nearest = 1.5f;
        foreach (Prop p in World.GetNearbyProps(x6HidePos, 8f))
        {
            if (p == null || !p.Exists() || p.Model.Hash != x6HideModel || owned.Contains(p)) continue;
            float d = p.Position.DistanceTo(x6HidePos); if (d < nearest) { nearest = d; restored = p; }
        }
        if (restored != null) { x6Target = restored; x6Orig = X4OriginalLab(restored); }
        if (x6Orig != null)
        {
            int w = X6Witness''')
(p/'WpsBreachLabX6.3.cs').write_text(s,encoding='utf-8',newline='')
print('X6 driver generated',len(s))
