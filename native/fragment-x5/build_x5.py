# Builds WpsBreachLabX5.3.cs from the X4 driver (PR #291) plus the X5 just-in-time block.
# usage: python3 build_x5.py [x4_driver] [x5_block] [output]
import re,sys,os
here=os.path.dirname(os.path.abspath(__file__))
x4=sys.argv[1] if len(sys.argv)>1 else os.path.join(here,'..','fragment-x4','WpsBreachLabX4.3.cs')
bk=sys.argv[2] if len(sys.argv)>2 else os.path.join(here,'x5block.cs')
outp=sys.argv[3] if len(sys.argv)>3 else os.path.join(here,'WpsBreachLabX5.3.cs')
s=open(x4,encoding='utf-8',newline='').read()
blk=open(bk,encoding='utf-8',newline='').read()
def rep(old,new,count=1):
    global s
    assert s.count(old)>=1, "missing: "+old[:60]
    if count==1: assert s.count(old)==1, "ambiguous: "+old[:60]
    s=s.replace(old,new)
rep('"WpsBreachLabX4.3.cs"','"WpsBreachLabX5.3.cs"',count=0)
rep('const string Ver = "X4-0.3";','const string Ver = "X5-0.1";')
rep('void OnAborted() { try { X4Restore(); } finally { try { CleanupAll(); RestorePlayer(); } catch { } } }',
    'void OnAborted() { try { X4Restore(); } catch { } try { X5Restore(); } finally { try { CleanupAll(); RestorePlayer(); } catch { } } }')
rep('finally { if (!x4Active) CleanupAll(); }','finally { if (!x4Active && x5State == "None") CleanupAll(); }')
rep('try { if (!x4Active) RestorePlayer(); } catch { }','try { if (!x4Active && x5State == "None") RestorePlayer(); } catch { }')
rep('        switch (verb)\n        {\n            case "x4setup": X4Setup(a); break;',
    '        if (x5State != "None" && !verb.StartsWith("x5") && verb != "abort") throw new Exception("restore_active_x5_first");\n        switch (verb)\n        {\n            case "x5prepare": X5Prepare(a); break;\n            case "x5shot": X5Shot(a); break;\n            case "x5walk": X5Walk(a); break;\n            case "x5restore": X5Restore(); break;\n            case "x5cam": X5Cam(a); break;\n            case "x4setup": X4Setup(a); break;')
rep("        owned.Add(p); L.Wall = p;\n","        owned.Add(p); L.Wall = p;\n        if (x5Dormant) { p.IsVisible = false; Function.Call(Hash.SET_ENTITY_COLLISION, p.Handle, false, true); }\n")
marker='    // ===================================================================== lab geometry\n'
assert s.count(marker)==1
s=s.replace(marker, blk+marker)
open(outp,'w',encoding='utf-8',newline='').write(s)
print("ok",len(s))
