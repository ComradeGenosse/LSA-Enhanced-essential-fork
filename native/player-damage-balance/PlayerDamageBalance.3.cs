using System;
using GTA;
using GTA.Native;

public class PlayerDamageBalance : Script
{
    // No blanket weapon-damage reduction: regular shots deal vanilla damage.
    private const float NormalWeaponDefenseModifier = 1.0f;

    // Only the current player character is protected from critical headshots.
    // NPCs retain the game's normal critical-hit behavior.
    private Ped _protectedPed;

    public PlayerDamageBalance()
    {
        // Reapply after respawns, player-character switches, or game resets.
        Interval = 1000;
        Tick += OnTick;
        Aborted += OnAborted;

        ApplyProtection();
    }

    private void OnTick(object sender, EventArgs e)
    {
        ApplyProtection();
    }

    private void ApplyProtection()
    {
        Player player = Game.Player;
        if (player == null)
            return;

        Ped currentPed = player.Character;
        if (currentPed == null || !currentPed.Exists())
            return;

        // A former player character can become an NPC after switching.
        // Remove our protection from that ped before protecting the new one.
        if (_protectedPed != null && _protectedPed.Handle != currentPed.Handle)
        {
            RestoreCriticalHits(_protectedPed);
            _protectedPed = null;
        }

        Function.Call(
            Hash.SET_PLAYER_WEAPON_DEFENSE_MODIFIER,
            player.Handle,
            NormalWeaponDefenseModifier
        );

        Function.Call(
            Hash.SET_PED_SUFFERS_CRITICAL_HITS,
            currentPed.Handle,
            false
        );
        _protectedPed = currentPed;
    }

    private void OnAborted(object sender, EventArgs e)
    {
        // Restore vanilla settings on unload. No NPC damage settings were changed.
        RestoreCriticalHits(_protectedPed);
        _protectedPed = null;

        Function.Call(
            Hash.SET_PLAYER_WEAPON_DEFENSE_MODIFIER,
            Game.Player.Handle,
            NormalWeaponDefenseModifier
        );
    }

    private static void RestoreCriticalHits(Ped ped)
    {
        // Vanilla ped behavior permits critical headshots.
        if (ped != null && ped.Exists())
        {
            Function.Call(
                Hash.SET_PED_SUFFERS_CRITICAL_HITS,
                ped.Handle,
                true
            );
        }
    }
}
