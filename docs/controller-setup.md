# Controller setup for LSA Enhanced gestures

This page sets up the UX phase 2 gestures (and the phase 3 menu) for a controller with back buttons, such as a Steam Deck, Steam Controller, DualSense Edge or Xbox Elite controller through Steam Input. Keyboard players can use the same keys directly.

| Gesture | Default key | What happens |
| --- | --- | --- |
| Tap L4 | F6 | **Mark**: LSA presses Essential's own `MarkPedKey` for you |
| Tap R4 | F8 | **Text**: LSA presses Essential's own `TextKey` for you |
| Press L4 and R4 together (within 120 ms) | F6 + F8 | **Follow** the current NPC: a promoted character follows through P2; an ordinary NPC is asked in character ("Follow me.") |
| Hold L4 and R4 (600 ms) | F6 + F8 | Opens the **Current NPC** page (needs the menu) |
| Menu key | F11 | Opens the **LSA menu** (needs the menu) |

Essential stays in charge of every NPC action. Mark and Text are relayed to Essential's keys; Follow goes through the existing P2 command or Essential's own typed input. Talk and Marked Talk keep their direct bindings.

## 1. Turn the gestures on

The gestures run in the P2 loader, so `Plugins/LSA.PromotedCharacters.json` must be enabled first (see [P2 setup](P2-promoted-characters-status.md)).

Copy `LSA.Enhanced.example.json` from the addon package to `Plugins/LSA.Enhanced.json` and set:

```json
"input": { "enabled": true, ... },
"ui": { "enabled": true }
```

`ui.enabled` is optional; without it the gestures work and the chord fires as soon as both keys are down. The file is reloaded within a second while GTA runs. `RagePluginHook.log` shows `[UX] settings_loaded …` or, for a mistake, `[UX] settings_rejected <setting>: <problem>` (the previous settings stay active).

## 2. Map the back buttons in Steam Input

1. In Steam, open **Grand Theft Auto V Enhanced → Manage → Controller layout** (or press the Steam button in game and choose **Controller settings**).
2. Choose **Edit layout → Back grips** (Steam Deck: L4/R4; other controllers: their back buttons or paddles).
3. Set **L4** to the keyboard key **F6** and **R4** to **F8**. Use a plain *Regular press* activator with no turbo, no hold activators and no chorded bindings.
4. Optional: bind another spare button to **F11** for the LSA menu.
5. Leave the existing bindings for Essential's Talk and Marked Talk keys as they are.
6. Save the layout under a new name so the previous layout stays available.

If your controller has no back buttons, any spare button works; use a keyboard key that GTA does not use.

## 3. Check it in game

- `RagePluginHook.log` shows `[UX] enhanced_host_started`, `[UX] essential_keys TalkKey=… TextKey=… MarkPedKey=… MarkedPedTalkKey=…`, `[UX] input_router state=ready` and an `[UX] input_latency` line.
- Tap L4: Essential marks the NPC you aim at, exactly as its own key does.
- Tap R4: Essential's text input opens.
- Press both: the HUD shows `Following`, `Asked to follow` or a reason such as `No current NPC`.
- With `ui.enabled`, the **Controls** page of the LSA menu shows the router keys, the active gestures and Essential's current keys.

L4 and R4 take part in a chord, so a single tap fires when the button is released or when the 120 ms chord window ends, whichever comes first. The `[UX] input_latency` line reports this per key. The chord window can be changed in `input.timing.chordWindowMs` (40–250 ms) or for one session on the Controls page.

## Keys and conflicts

- Router keys must not be one of Essential's keys (`TalkKey`, `TextKey`, `MarkPedKey`, `MarkedPedTalkKey` in `Plugins/LosSantosAlive/LosSantosAlive.config`). If they are, LSA pauses all gestures and shows `Input paused: F6 is also Essential's MarkPedKey`; change one of the two keys.
- Never used as router keys: F4 (RPH console), F7 (Essential's controls menu), F12 (Steam screenshot), Escape, Enter, Tab, Space and the left, right and middle mouse buttons.
- Accepted key names: `F1`–`F24`, `A`–`Z`, `D0`–`D9` (or `0`–`9`), `NumPad0`–`NumPad9`, `Mouse4`, `Mouse5`, `Insert`, `Delete`, `Home`, `End`, `PageUp`, `PageDown`, `Up`, `Down`, `Left`, `Right`, `Pause`, `ScrollLock`, `CapsLock`, `Back`, `Multiply`, `Add`, `Subtract`, `Decimal`, `Divide` and the left/right Shift, Control and Alt keys (`LShiftKey`, `RControlKey`, `LMenu`, …).
- If Essential's Mark or Text key is set to `None`, the gesture shows `Bind this key in Essential's F7 menu`. A left, right or middle mouse button cannot be relayed (`Essential's key cannot be relayed`).

Nothing fires while the RPH console is open, the game is paused or not focused, Essential's text input or F7 menu is open, or during loading screens, cutscenes and player switches. The last four are reported by the P2 native host; if it is not running, Mark and Text still work like Essential's own keys. While an LSA menu is open, only the menu toggles pass; Essential still reads its own keys.

## Talk target selector

This is optional and off until `talkTargeting.enabled` is true. It uses the same physical Talk button in two modes. **Hold normally** (past `talkHoldMs`, 220 ms by default) to talk directly to the best nearby candidate with no selection bracket. **Tap** to enter explicit targeting mode; further taps cycle the nearby candidates. Holding while that explicit target remains valid speaks to that exact NPC. The bracket previews briefly and disappears when PTT starts. Releasing the button ends that microphone turn. Essential's configured `TalkKey` is not changed and is not pressed for you.

The highlight is a screen bracket on the NPC, including a driver or passenger, with a small `2/3` label when more than one NPC is in range. Follow, Wait, Promote and the Current NPC page use that highlighted NPC while the selection lasts. Typed text still uses Essential's own target choice.

### Recommended: reuse your existing Essential Talk binding

No Steam Input remap is required. Set `talkTargeting.key` to the **same physical key already configured as Essential's `TalkKey`**. UX4 acquires a separate input-interception lease: it reads the real key state directly while Essential sees that physical Talk press as released, preventing the stock generic Talk path from firing a second time.

Example, if your existing controller button sends `Mouse4` and Essential's `TalkKey` is also `Mouse4`:

```json
"talkTargeting": { "enabled": true, "key": "Mouse4" }
```

Your controller mapping stays unchanged. Marked Talk also stays unchanged.

A neutral dedicated key such as `F10` is still supported if preferred. In that mode, map the physical Talk button to the neutral key instead of Essential Talk.

The UX4 key must not collide with Essential's `TextKey`, `MarkPedKey`, or `MarkedPedTalkKey`, and it must not be one of `input.keys`. A key that matches **only** Essential's `TalkKey` is now intentional shared-input mode.

`RagePluginHook.log` shows either:

- `[UX4] talk_target input=ready key=<key> mode=shared_essential`
- `[UX4] talk_target input=ready key=<key> mode=neutral`

A tap selects/cycles and does not start the microphone. A hold starts UX4 PTT against the exact selected NPC.

Search radius defaults to 15 m, the highlight lasts 8 s, and repeated taps keep one frozen order for 1.5 s. No line of sight is required, so a seated NPC stays selectable.

## Rollback

- **Gestures off:** set `"input": { "enabled": false }` in `Plugins/LSA.Enhanced.json`, or delete the file. The router stops within a second; no restart is needed.
- **Menu off:** set `"ui": { "enabled": false }`.
- **Controller:** in Steam Input choose **Browse configs** and pick your previous layout, or clear the L4/R4 bindings.
- **Talk targeting off:** set `"talkTargeting": { "enabled": false }` or delete that section. If UX4 shares Essential's existing Talk key, interception is released automatically and the same controller button returns to stock Essential Talk after the physical key is released. If you chose a separate neutral key, restore your previous Steam Input mapping manually. `LosSantosAlive.config` is never modified.
- Removing the gestures never changes Essential's own keys or `LosSantosAlive.config`; LSA only reads that file.
