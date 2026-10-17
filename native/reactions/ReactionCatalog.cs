using System;
using System.Collections.Generic;

namespace LSA.Reactions
{
    // Closed catalog of cosmetic conversation reactions. The wire carries only a
    // name from this list; dictionaries, clips, flags and durations are chosen
    // here and nowhere else, and never by a model or a companion frame.
    //
    // Provenance: candidate (dictionary, clip) pairs come from NPCTalk's table
    // (MIT, GTA V Legacy) and from widely used third-party emote lists. NONE of
    // them is verified on GTA V Enhanced. The executor resolves them at runtime
    // (DOES_ANIM_DICT_EXIST, REQUEST/HAS_ANIM_DICT_LOADED, GET_ANIM_DURATION > 0)
    // and uses the first one that is really present; if none is, the reaction
    // is skipped. See docs/plans/npc-gestures-findings.md.
    public sealed class ReactionClip
    {
        public readonly string Dict, Clip;
        public ReactionClip(string dict, string clip) { Dict = dict; Clip = clip; }
    }

    public sealed class ReactionSpec
    {
        public readonly string Name;
        // Hard ceiling for the gesture, whatever the clip length.
        public readonly int MaxMs;
        public readonly float BlendIn, BlendOut;
        // True for reactions that never run unless native config lists them in
        // reactions.enabled (nod, shrug: unverified on Enhanced and head-adjacent).
        public readonly bool OptIn;
        // Deterministic offset into the line: StartMinMs .. StartMinMs+StartSpanMs-1.
        public readonly int StartMinMs, StartSpanMs;
        readonly ReactionClip[] male, female;
        public ReactionSpec(string name, int maxMs, ReactionClip[] male, ReactionClip[] female,
            bool optIn = false, int startMinMs = 500, int startSpanMs = 700)
        {
            Name = name; MaxMs = maxMs; BlendIn = 4f; BlendOut = -4f; this.male = male; this.female = female;
            OptIn = optIn; StartMinMs = startMinMs; StartSpanMs = startSpanMs;
        }
        public IReadOnlyList<ReactionClip> Candidates(bool isMale) => isMale ? male : female;
    }

    public static class ReactionCatalog
    {
        public const string Facepalm = "facepalm";
        public const string MiddleFinger = "middle_finger";
        public const string Nod = "nod";
        public const string Shrug = "shrug";
        // TASK_PLAY_ANIM flag bits: 16 = upper body only, 32 = secondary task slot.
        // Playing in the secondary slot is what is meant to leave the primary
        // task (walking, following, scenarios) untouched. UNVERIFIED on Enhanced.
        public const int UpperBodyFlag = 16, SecondaryFlag = 32;
        public const int PlayFlags = UpperBodyFlag | SecondaryFlag;

        static readonly Dictionary<string, ReactionSpec> specs = Build();

        static Dictionary<string, ReactionSpec> Build()
        {
            var facepalmCommon = new[]
            {
                new ReactionClip("anim@mp_player_intupperface_palm", "idle_a"),
            };
            var fingerCommon = new[]
            {
                new ReactionClip("anim@mp_player_intupperfinger", "idle_a"),
                new ReactionClip("anim@mp_player_intupperfinger", "idle_a_fp"),
            };
            // Ambient conversation gestures that ship with the base game for male and
            // female peds. Candidates only: existence on Enhanced is UNVERIFIED and
            // is resolved at runtime exactly like the two clips above.
            var nodMale = new[]
            {
                new ReactionClip("gestures@m@standing@casual", "gesture_nod_yes_soft"),
                new ReactionClip("gestures@m@standing@casual", "gesture_nod_yes_hard"),
            };
            var nodFemale = new[]
            {
                new ReactionClip("gestures@f@standing@casual", "gesture_nod_yes_soft"),
                new ReactionClip("gestures@f@standing@casual", "gesture_nod_yes_hard"),
            };
            var shrugMale = new[]
            {
                new ReactionClip("gestures@m@standing@casual", "gesture_shrug_soft"),
                new ReactionClip("gestures@m@standing@casual", "gesture_shrug_hard"),
            };
            var shrugFemale = new[]
            {
                new ReactionClip("gestures@f@standing@casual", "gesture_shrug_soft"),
                new ReactionClip("gestures@f@standing@casual", "gesture_shrug_hard"),
            };
            return new Dictionary<string, ReactionSpec>
            {
                { Facepalm, new ReactionSpec(Facepalm, 1800,
                    Concat(facepalmCommon, new ReactionClip("anim@mp_player_intcelebrationmale@face_palm", "face_palm")),
                    Concat(facepalmCommon, new ReactionClip("anim@mp_player_intcelebrationfemale@face_palm", "face_palm"),
                        new ReactionClip("anim@mp_player_intcelebrationmale@face_palm", "face_palm"))) },
                { MiddleFinger, new ReactionSpec(MiddleFinger, 1500,
                    Concat(fingerCommon, new ReactionClip("anim@mp_player_intcelebrationmale@finger", "finger"),
                        new ReactionClip("mp_player_intfinger", "mp_player_int_finger"),
                        new ReactionClip("anim@mp_player_intselfiethe_bird", "idle_a")),
                    Concat(fingerCommon, new ReactionClip("anim@mp_player_intcelebrationfemale@finger", "finger"),
                        new ReactionClip("mp_player_intfinger", "mp_player_int_finger"),
                        new ReactionClip("anim@mp_player_intselfiethe_bird", "idle_a"))) },
                // Nod lands early in the line (agreement is usually the first words).
                { Nod, new ReactionSpec(Nod, 1400, nodMale, Concat(nodFemale, nodMale), true, 250, 450) },
                { Shrug, new ReactionSpec(Shrug, 1800, shrugMale, Concat(shrugFemale, shrugMale), true, 400, 500) },
            };
        }

        static ReactionClip[] Concat(ReactionClip[] first, params ReactionClip[] more)
        {
            var all = new ReactionClip[first.Length + more.Length];
            Array.Copy(first, all, first.Length);
            Array.Copy(more, 0, all, first.Length, more.Length);
            return all;
        }

        // Facial dictionaries the existing voice-presence overlay already depends
        // on. Only their existence is ever probed here (diagnostics); no facial
        // clip is played by reactions. See docs/plans/npc-facial-acting-g1-verdict.md.
        public static readonly string[] FacialProbeDicts =
            { "mp_facial", "facials@gen_male@base", "facials@gen_female@base" };

        public static bool IsKnown(string name) => name != null && specs.ContainsKey(name);
        public static ReactionSpec Get(string name) => name != null && specs.TryGetValue(name, out var spec) ? spec : null;
        public static IEnumerable<string> Names => specs.Keys;
    }
}
