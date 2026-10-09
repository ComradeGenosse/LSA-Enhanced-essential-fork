using System;
using System.Collections.Generic;
using System.Reflection;
using LosSantosAlive.Input;
using Rage;

namespace LSA.PromotedCharacters
{
    // Source-pinned view of Essential's single active microphone Ped.
    // We derive the field from SendMicStop's IL instead of naming the
    // obfuscated private field. DomainHost has already hash-pinned Core.
    internal sealed class EssentialMicState
    {
        readonly FieldInfo activePed;
        readonly string status;

        public EssentialMicState()
        {
            try {
                activePed = ResolveActivePedField();
                status = activePed == null ? "mic_state_unavailable" : "ready";
            } catch {
                activePed = null;
                status = "mic_state_unavailable";
            }
        }

        public string Status => status;
        public bool Available => activePed != null;

        public string CanStart()
        {
            if (activePed == null) return "mic_state_unavailable";
            // A failed private-field read is unknown, never proof of idle.
            return TryRead(out var current) ? (current == null ? null : "mic_busy") : "mic_state_unavailable";
        }

        public bool Owns(Ped ped,long address)
        {
            if (activePed == null || ped == null || address == 0) return false;
            if (!TryRead(out var current) || current == null || current != ped) return false;
            try { return current.MemoryAddress.ToInt64() == address; } catch { return false; }
        }

        // null => SendMicStop ran and the field is clear.
        // already_stopped / ownership_lost => release UX4 ownership without
        // touching Essential's current microphone.
        // native_operation_failed => retain UX4 ownership and retry.
        public string StopOwned(Ped ped,long address)
        {
            if (activePed == null) return "mic_state_unavailable";
            if (!TryRead(out var current)) return "mic_state_unavailable";
            if (current == null) return "already_stopped";
            if (ped == null || current != ped) return "ownership_lost";
            try {
                if (current.MemoryAddress.ToInt64() != address) return "ownership_lost";
            } catch { return "ownership_lost"; }

            try { InputController.SendMicStop(); }
            catch { return "native_operation_failed"; }

            return TryRead(out var after) && after == null ? null : "native_operation_failed";
        }

        bool TryRead(out Ped current)
        {
            current = null;
            if (activePed == null) return false;
            try {
                var value = activePed.GetValue(null);
                if (value == null) return true;
                current = value as Ped;
                return current != null;
            } catch { return false; }
        }

        static FieldInfo ResolveActivePedField()
        {
            var stop = typeof(InputController).GetMethod("SendMicStop",BindingFlags.Public | BindingFlags.Static,null,Type.EmptyTypes,null);
            var il = stop?.GetMethodBody()?.GetILAsByteArray();
            if (stop == null || il == null || il.Length < 5) return null;

            var reads = new HashSet<FieldInfo>();
            var writes = new HashSet<FieldInfo>();
            for (int index = 0; index + 4 < il.Length; index++) {
                byte opcode = il[index];
                if (opcode != 0x7e && opcode != 0x80) continue; // ldsfld / stsfld
                FieldInfo field = null;
                try {
                    int token = BitConverter.ToInt32(il,index + 1);
                    field = stop.Module.ResolveField(token);
                } catch { }
                if (field == null || !field.IsStatic || field.DeclaringType != typeof(InputController) || field.FieldType != typeof(Ped)) continue;
                if (opcode == 0x7e) reads.Add(field); else writes.Add(field);
            }

            FieldInfo found = null;
            foreach (var field in reads) {
                if (!writes.Contains(field)) continue;
                if (found != null && found != field) return null;
                found = field;
            }
            return found;
        }
    }
}
