using System;
using System.Collections.Generic;
using System.Linq;
using Rage;
using Rage.Native;

namespace LSA.Enhanced.Ui
{
    // Only operates on the player's own car, player, or vehicles created in this instance.
    // Runs on EnhancedHost's loader GameFiber, never the P2/Essential character owner.
    internal sealed class VehicleCheats
    {
        const int MaxSpawned = 16;
        readonly List<Vehicle> created = new List<Vehicle>();
        readonly Action<string> log;
        public VehicleCheats(Action<string> logger) { log = logger ?? (_ => {}); }
        static Ped PlayerPed()
        {
            var ped = Game.LocalPlayer.Character;
            return ped != null && ped.IsValid() && !ped.IsDead ? ped : null;
        }
        static Vehicle Current()
        {
            var ped = PlayerPed();
            var car = ped?.CurrentVehicle;
            return car != null && car.IsValid() ? car : null;
        }
        public string CurrentModel()
        {
            try { return VehicleFavorites.Normalize(Current()?.Model.Name); }
            catch { return null; }
        }
        public bool InVehicle { get { try { return Current() != null; } catch { return false; } } }
        public int WantedLevel { get { try { return Game.LocalPlayer.WantedLevel; } catch { return -1; } } }
        public bool Invincible
        {
            get { try { return Game.LocalPlayer.IsInvincible; } catch { return false; } }
        }
        public string Apply(string action)
        {
            try {
                if (Game.IsPaused) return "Unavailable while paused";
                switch (action) {
                    case "repair": {
                        var car = Current(); if (car == null) return "Enter a vehicle first";
                        car.Repair(); car.RepairComponents(VehicleComponents.All); return "Vehicle repaired (game-native damage)";
                    }
                    case "clean": {
                        var car = Current(); if (car == null) return "Enter a vehicle first";
                        car.DirtLevel = 0f; return "Vehicle cleaned";
                    }
                    case "upright": {
                        var car = Current(); if (car == null) return "Enter a vehicle first";
                        return NativeFunction.CallByHash<bool>(0x49733E92263139D1UL,car,5f) ? "Vehicle placed on its wheels" : "Unable to place vehicle here";
                    }
                    case "heal": {
                        var ped = PlayerPed(); if (ped == null) return "Player unavailable";
                        ped.Health = ped.MaxHealth; return "Player health restored";
                    }
                    case "armor": {
                        var ped = PlayerPed(); if (ped == null) return "Player unavailable";
                        ped.Armor = 100; return "Armor restored";
                    }
                    case "wanted":
                        Game.LocalPlayer.WantedLevel = 0; return "Wanted level cleared";
                    case "invincible":
                        Game.LocalPlayer.IsInvincible = !Game.LocalPlayer.IsInvincible;
                        return Game.LocalPlayer.IsInvincible ? "Player invincibility ON" : "Player invincibility OFF";
                    case "deleteLast": return DeleteLast();
                    default: return "Unknown cheat";
                }
            } catch (Exception error) {
                log("[CHEAT] action_failed op=" + action + " reason=" + error.GetType().Name);
                return "Cheat failed (see RPH log)";
            }
        }
        public bool IsVehicleModel(string input)
        {
            string name = VehicleFavorites.Normalize(input);
            if (name == null) return false;
            try {
                var model = new Model(name);
                return model.IsValid && model.IsVehicle;
            } catch { return false; }
        }
        public string Spawn(string input)
        {
            string name = VehicleFavorites.Normalize(input);
            if (name == null) return "Enter a valid vehicle model name";
            try {
                if (Game.IsPaused) return "Unavailable while paused";
                var player = PlayerPed(); if (player == null) return "Player unavailable";
                created.RemoveAll(v => v == null || !v.IsValid());
                if (created.Count >= MaxSpawned) return "16 spawned vehicles max; delete the last one";
                var model = new Model(name);
                if (!model.IsValid || !model.IsVehicle) return "Vehicle model unavailable: " + name;
                // Spawn near the player, without moving the player or taking an NPC's seat.
                var vehicle = new Vehicle(model,player.GetOffsetPosition(new Vector3(4f,9f,0f)),player.Heading);
                if (vehicle == null || !vehicle.IsValid()) return "Vehicle spawn failed";
                vehicle.MakePersistent();
                created.Add(vehicle);
                return "Spawned " + name + " nearby";
            } catch (Exception error) {
                log("[CHEAT] spawn_failed reason=" + error.GetType().Name);
                return "Vehicle spawn failed (see RPH log)";
            }
        }
        string DeleteLast()
        {
            try {
                created.RemoveAll(v => v == null || !v.IsValid());
                if (created.Count == 0) return "No cheat-spawned vehicles to delete";
                var last = created[created.Count - 1];
                // Refuse if anybody occupies it; never delete an ambient or P2-owned vehicle.
                if (!last.CreatedByTheCallingPlugin) {
                    created.RemoveAt(created.Count - 1);
                    return "Spawn ownership no longer verified; not deleting";
                }
                // Native occupant checks must succeed and return zero, otherwise fail closed.
                int passengers = NativeFunction.CallByHash<int>(0x24CB2137731FFE89UL,last);
                if (Current() == last || passengers != 0
                    || last.Driver != null && last.Driver.IsValid()) return "Vehicle occupied or occupancy unknown; exit first";
                last.Delete();
                created.RemoveAt(created.Count - 1);
                return "Last cheat-spawned vehicle removed";
            } catch (Exception error) {
                log("[CHEAT] delete_failed reason=" + error.GetType().Name);
                return "Unable to delete spawned vehicle";
            }
        }
    }
}
