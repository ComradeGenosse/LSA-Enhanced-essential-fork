using System;
using LSA.PromotedCharacters;
int count = 0;
void Check(bool test) { count++; if (!test) throw new Exception("P2 production policy assertion " + count); }
Check(NativeSafetyPolicy.CanControl(true,false,false,false,false,false));
Check(!NativeSafetyPolicy.CanControl(false,false,false,false,false,false));
Check(!NativeSafetyPolicy.CanControl(true,true,false,false,false,false));
Check(!NativeSafetyPolicy.CanControl(true,false,true,false,false,false));
Check(!NativeSafetyPolicy.CanControl(true,false,false,true,false,false));
Check(!NativeSafetyPolicy.CanControl(true,false,false,false,true,false));
Check(!NativeSafetyPolicy.CanControl(true,false,false,false,false,true));
Check(!NativeSafetyPolicy.Current(null,null)); Check(NativeSafetyPolicy.Current("one","one")); Check(!NativeSafetyPolicy.Current("one","replacement"));
Check(NativeSafetyPolicy.Fresh(2000,1000));Check(!NativeSafetyPolicy.Fresh(1000,1000));Check(!NativeSafetyPolicy.Fresh(999,1000));Check(!NativeSafetyPolicy.Fresh(99999,1000));
Check(NativeSafetyPolicy.VariationAvailable(0,0,1,1));
Check(!NativeSafetyPolicy.VariationAvailable(0,0,0,0)); // A static model slot must not be serialized for later setters.
Check(!NativeSafetyPolicy.VariationAvailable(-1,0,1,1));Check(!NativeSafetyPolicy.VariationAvailable(1,0,1,1));
Check(!NativeSafetyPolicy.VariationAvailable(0,-1,1,1));Check(!NativeSafetyPolicy.VariationAvailable(0,1,1,1));
string epoch = Guid.NewGuid().ToString("D"),world = Guid.NewGuid().ToString("D"),id = Guid.NewGuid().ToString("D");
var admission = new OperationAdmission(epoch,world);
Check(admission.Admit(id,epoch,world,2000,1000));Check(!admission.Admit(id,epoch,world,2000,1000));
Check(!admission.Admit(Guid.NewGuid().ToString("D"),"old epoch",world,2000,1000));Check(!admission.Admit(Guid.NewGuid().ToString("D"),epoch,"other world",2000,1000));
Check(!admission.Admit("ped17",epoch,world,2000,1000));Check(!admission.Admit(Guid.NewGuid().ToString("D"),epoch,world,999,1000));
Console.WriteLine($"P2 production safety/admission: {count} assertions passed; no game assemblies loaded.");
