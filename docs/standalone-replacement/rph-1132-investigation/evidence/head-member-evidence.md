| # | HEAD import (exact compiled signature) | In official SDK | LSPDFR (ships with 1.132) | Your Essential (ran) | Your Smart Vehicle Entry (ran) | Your other installed plugins (static only) | **Executed on your 1.132** |
|---|---|---|---|---|---|---|---|
| 1 | `Rage.Attributes.PluginAttribute::.ctor(System.String):System.Void instance` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| 2 | `Rage.Attributes.ConsoleCommandAttribute::.ctor():System.Void instance` | ✓ | ✓ | — | — | ✓ | — |
| 3 | `Rage.Game::LogTrivial(System.String):System.Void static` | ✓ | ✓ | ✓ | ✓ | ✓ | **✓ proven** |
| 4 | `Rage.Game::get_GameTime():System.UInt32 static` | ✓ | ✓ | ✓ | ✓ | ✓ | **✓ proven** |
| 5 | `Rage.GameFiber::Sleep(System.Int32):System.Void static` | ✓ | ✓ | ✓ | — | ✓ | **✓ proven** |
| 6 | `Rage.Entity::op_Equality(Rage.Entity,Rage.Entity):System.Boolean static` | ✓ | ✓ | ✓ | — | ✓ | — |
| 7 | `Rage.Entity::get_Handle():Rage.PoolHandle instance` | ✓ | ✓ | ✓ | — | ✓ | — |
| 8 | `Rage.PoolHandle::get_Value():System.UInt32 instance` | ✓ | ✓ | ✓ | — | ✓ | — |
| 9 | `Rage.Native.NativeArgument::op_Implicit(System.Int32):Rage.Native.NativeArgument static` | ✓ | ✓ | — | — | ✓ | — |
| 10 | `Rage.Native.NativeFunction::CallByName`1(System.String,Rage.Native.NativeArgument[]):!!0 static` | ✓ | ✓ | — | — | ✓ | — |
| 11 | `Rage.GameFiber::get_CanSleepNow():System.Boolean static` | ✓ | — | — | — | ✓ | **✓ proven** |
| 12 | `Rage.Native.NativeArgument::op_Implicit(System.String):Rage.Native.NativeArgument static` | ✓ | ✓ | — | — | ✓ | — |
| 13 | `Rage.PoolHandle::.ctor(System.UInt32):System.Void instance` | ✓ | ✓ | — | — | — | — |
| 14 | `Rage.World::GetEntityByHandle`1(Rage.PoolHandle):!!0 static` | ✓ | ✓ | — | — | — | — |
| 15 | `Rage.Entity::op_Inequality(Rage.Entity,Rage.Entity):System.Boolean static` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| 16 | `Rage.Entity::get_IsDead():System.Boolean instance` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| 17 | `Rage.Game::get_LocalPlayer():Rage.Player static` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| 18 | `Rage.Player::get_Character():Rage.Ped instance` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| 19 | `Rage.Entity::get_MemoryAddress():System.IntPtr instance` | ✓ | ✓ | — | — | ✓ | — |
| 20 | `Rage.Game::get_Console():Rage.GameConsole static` | ✓ | ✓ | — | — | ✓ | — |
| 21 | `Rage.GameConsole::Print(System.String):System.Void instance` | ✓ | ✓ | — | — | ✓ | — |
| 22 | `Rage.Entity::DistanceTo(Rage.ISpatial):System.Single instance` | ✓ | ✓ | ✓ | — | — | — |
| 23 | `Rage.Entity::GetOffsetPositionFront(System.Single):Rage.Vector3 instance` | ✓ | ✓ | ✓ | — | — | — |
| 24 | `Rage.Ped::GetNearbyPeds(System.Int32):Rage.Ped[] instance` | ✓ | — | ✓ | — | — | — |
| 25 | `Rage.Entity::DistanceTo(Rage.Vector3):System.Single instance` | ✓ | ✓ | ✓ | — | ✓ | — |
| 26 | `Rage.Native.NativeFunction::CallByHash`1(System.UInt64,Rage.Native.NativeArgument[]):!!0 static` | ✓ | ✓ | — | — | ✓ | — |
| 27 | `Rage.Native.NativeFunction::CallByHash(System.UInt64,System.Type,Rage.Native.NativeArgument[]):System.Object static` | ✓ | ✓ | — | — | ✓ | — |
| 28 | `Rage.Entity::get_Position():Rage.Vector3 instance` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| 29 | `Rage.Vector3::op_Subtraction(Rage.Vector3,Rage.Vector3):Rage.Vector3 static` | ✓ | ✓ | ✓ | — | — | — |
| 30 | `Rage.Vector3::X:System.Single field` | ✓ | ✓ | ✓ | — | ✓ | — |
| 31 | `Rage.Vector3::Y:System.Single field` | ✓ | ✓ | ✓ | — | ✓ | — |
| 32 | `Rage.Vector3::Z:System.Single field` | ✓ | ✓ | ✓ | — | ✓ | — |
| 33 | `Rage.Entity::get_RightVector():Rage.Vector3 instance` | ✓ | — | ✓ | — | — | — |
| 34 | `Rage.Native.NativeFunction::CallByName`1(System.String,Rage.Native.NativeArgument[]):!!0 static<System.Boolean>` | ✓ | ✓ | — | — | ✓ | — |
| 35 | `Rage.Native.NativeFunction::CallByName`1(System.String,Rage.Native.NativeArgument[]):!!0 static<System.Int32>` | ✓ | ✓ | — | — | ✓ | — |
| 36 | `Rage.World::GetEntityByHandle`1(Rage.PoolHandle):!!0 static<Rage.Ped>` | ✓ | ✓ | — | — | — | — |
| 37 | `Rage.Native.NativeFunction::CallByHash`1(System.UInt64,Rage.Native.NativeArgument[]):!!0 static<System.Int32>` | ✓ | ✓ | — | — | ✓ | — |
