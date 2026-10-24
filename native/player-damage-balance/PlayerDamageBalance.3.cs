using System;
using GTA;
using GTA.Native;

public class PlayerDamageBalance : Script
{
    // Incoming weapon damage multiplier for the PLAYER ONLY.
    // 1.00 = vanilla incoming damage
    // 0.75 = 75% damage
    // 0.55 = 55% damage
    // 0.40 = 40% damage
    private const float WeaponDefenseModifier = 0.20f;

    public PlayerDamageBalance()
    {
        // Re-apply periodically so character switches / other game state changes
        // are less likely to reset the modifier.
        Interval = 1000;
        Tick += OnTick;
        Aborted += OnAborted;

        ApplyModifier();
    }

    private void OnTick(object sender, EventArgs e)
    {
        ApplyModifier();
    }

    private void ApplyModifier()
    {
        Function.Call(
            Hash.SET_PLAYER_WEAPON_DEFENSE_MODIFIER,
            Game.Player.Handle,
            WeaponDefenseModifier
        );
    }

    private void OnAborted(object sender, EventArgs e)
    {
        // Restore the game's normal value when this script is unloaded.
        Function.Call(
            Hash.SET_PLAYER_WEAPON_DEFENSE_MODIFIER,
            Game.Player.Handle,
            1.0f
        );
    }
}
