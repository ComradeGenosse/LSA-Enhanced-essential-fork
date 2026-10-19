"""Hand-written reference experiences (one per selected vision) used by the experiments.

These are researcher-authored examples of the IR, not model output. They exist so the
validator, monitors and adaptation policies can be exercised on recognisable shapes.
"""
import copy

COURIER_JOB = {  # #23 Fully improvised mission ("Let's pull off a job")
    "id": "fx-courier-job", "mode": "mission", "genre": ["heist"], "consent": "player_requested",
    "pitch": "A courier is moving a case from the docks. Get a fast car, take the case, lose the crew that comes after you.",
    "player_start": "downtown",
    "roles": [
        {"id": "player", "kind": "player", "source": "player"},
        {"id": "nathan", "kind": "ped", "source": "companion", "tags": ["promoted"]},
        {"id": "getaway", "kind": "vehicle", "source": "spawn", "tags": ["sports", "affordance"], "place": "vinewood_blvd"},
        {"id": "courier", "kind": "ped", "source": "spawn", "tags": ["armed"], "place": "terminal_docks"},
        {"id": "van", "kind": "vehicle", "source": "spawn", "tags": ["van"], "place": "terminal_docks", "driver": "courier"},
        {"id": "case", "kind": "item", "source": "spawn", "tags": [], "in": "courier"},
        {"id": "safehouse", "kind": "place", "source": "atlas", "place": "grapeseed"},
        {"id": "chaser", "kind": "ped", "source": "spawn", "tags": ["armed"], "place": "davis", "deferred": True},
        {"id": "chase_car", "kind": "vehicle", "source": "spawn", "tags": ["car"], "place": "davis", "driver": "chaser", "deferred": True},
    ],
    "start": "s1",
    "stages": [
        {"id": "s1", "timeout": 20,
         "objectives": [
             {"id": "o1", "kind": "success", "formula": {"f": "in_any_vehicle", "args": ["player"]}},
             {"id": "f1", "kind": "failure", "formula": {"or": [{"f": "player_wasted"}, {"f": "player_busted"}]}}],
         "policies": [{"role": "nathan", "cap": "follow_player", "consented": True}],
         "rules": [], "on_success": "s2", "on_failure": "END_FAILURE", "on_timeout": "END_FAILURE"},
        {"id": "s2", "timeout": 30,
         "objectives": [
             {"id": "o2", "kind": "success", "formula": {"f": "holding", "args": ["player", "case"]}},
             {"id": "f2", "kind": "failure", "formula": {"or": [{"f": "near", "args": ["van", "mission_row"]},
                                                                {"f": "player_wasted"}, {"f": "player_busted"}]}}],
         "policies": [{"role": "nathan", "cap": "follow_player", "consented": True},
                      {"role": "courier", "cap": "gm_drive_to", "args": {"dest": "mission_row"}}],
         "rules": [{"id": "spotted", "on": {"f": "together", "args": ["player", "van"]},
                    "then": [{"do": "deactivate", "role": "courier"},
                             {"do": "activate", "role": "courier", "cap": "gm_vehicle_flee", "args": {"from": "player"}},
                             {"do": "speak_beat", "beat": "courier_spotted_us"}]}],
         "on_success": "s3", "on_failure": "END_FAILURE", "on_timeout": "END_FAILURE"},
        {"id": "s3", "timeout": 30,
         "objectives": [
             {"id": "o3", "kind": "success", "formula": {"and": [{"f": "near", "args": ["player", "safehouse"]},
                                                                 {"f": "holding", "args": ["player", "case"]}]}},
             {"id": "f3", "kind": "failure", "formula": {"or": [{"f": "player_wasted"}, {"f": "player_busted"}]}}],
         "policies": [{"role": "nathan", "cap": "follow_player", "consented": True},
                      {"role": "chaser", "cap": "gm_vehicle_chase", "args": {"target": "player"}}],
         "rules": [{"id": "crew", "on": {"f": "timer_elapsed", "args": [1]},
                    "then": [{"do": "spawn", "role": "chaser"}, {"do": "spawn", "role": "chase_car"},
                             {"do": "speak_beat", "beat": "we_have_company"}]}],
         "on_success": "END_SUCCESS", "on_failure": "END_FAILURE", "on_timeout": "END_FAILURE"},
    ],
    "invariants": [{"id": "case_exists", "formula": {"f": "exists", "args": ["case"]}}],
    "accommodations": [
        {"threat": {"role_lost": "courier"}, "then": [{"do": "note", "text": "case drops where the courier fell"}]},
        {"threat": {"role_lost": "van"}, "then": [{"do": "note", "text": "case drops at the wreck"}]},
        {"threat": {"role_lost": "chaser"}, "then": [{"do": "speak_beat", "beat": "lost_the_crew"}]},
    ],
    "consequences": [{"on": "END_SUCCESS", "effect": "ledger_fact", "fact": "crew_from_docks_hostile"}],
    "budgets": {"steps": 80},
}

TAIL_THE_WITNESS = {  # #6 action scene seeded by #20 opportunity: tail, then intercept
    "id": "fx-tail-witness", "mode": "action_scene", "genre": ["thriller"], "consent": "offered",
    "pitch": "A witness is driving to Mission Row. Stay on her without getting spotted, then stop her before she reaches the station.",
    "player_start": "vinewood_blvd",
    "roles": [
        {"id": "player", "kind": "player", "source": "player"},
        {"id": "player_car", "kind": "vehicle", "source": "spawn", "tags": ["car", "affordance"], "place": "vinewood_blvd"},
        {"id": "witness", "kind": "ped", "source": "spawn", "tags": [], "place": "vinewood_hills"},
        {"id": "w_car", "kind": "vehicle", "source": "spawn", "tags": ["car"], "place": "vinewood_hills", "driver": "witness"},
        {"id": "station", "kind": "place", "source": "atlas", "place": "mission_row"},
    ],
    "start": "s1",
    "stages": [
        {"id": "s1", "timeout": 25,
         "objectives": [
             {"id": "o1", "kind": "success", "formula": {"or": [{"f": "dead", "args": ["witness"]},
                                                                {"not": {"f": "vehicle_driveable", "args": ["w_car"]}},
                                                                {"f": "conversed", "args": ["witness"]}]}},
             {"id": "f1", "kind": "failure", "formula": {"or": [{"f": "near", "args": ["witness", "station"]},
                                                                {"f": "player_wasted"}, {"f": "player_busted"}]}}],
         "policies": [{"role": "witness", "cap": "gm_drive_to", "args": {"dest": "mission_row"}}],
         "rules": [{"id": "spooked", "on": {"held": {"f": "together", "args": ["player", "witness"]}, "n": 2},
                    "then": [{"do": "deactivate", "role": "witness"},
                             {"do": "activate", "role": "witness", "cap": "gm_vehicle_flee", "args": {"from": "player"}}]}],
         "on_success": "END_SUCCESS", "on_failure": "END_FAILURE", "on_timeout": "END_FAILURE"},
    ],
    "accommodations": [{"threat": {"role_lost": "w_car"}, "then": [{"do": "note", "text": "witness continues on foot"},
                                                                   {"do": "activate", "role": "witness", "cap": "gm_walk_to", "args": {"dest": "mission_row"}}]}],
    "consequences": [{"on": "END_SUCCESS", "effect": "ledger_fact", "fact": "witness_silenced_or_persuaded"}],
    "budgets": {"steps": 40},
}

LOST_DOG_OUTING = {  # #3 AI-generated adventure (companion-led outing) - uses no scene combat
    "id": "fx-outing", "mode": "adventure", "genre": ["outing"], "consent": "offered",
    "pitch": "Nathan heard about a lighthouse keeper's dog lost near Paleto Forest. Drive up, ask around Grapeseed, follow the trail.",
    "player_start": "downtown",
    "roles": [
        {"id": "player", "kind": "player", "source": "player"},
        {"id": "nathan", "kind": "ped", "source": "companion", "tags": ["promoted"]},
        {"id": "player_car", "kind": "vehicle", "source": "spawn", "tags": ["offroad", "affordance"], "place": "downtown"},
        {"id": "farmer", "kind": "ped", "source": "spawn", "tags": ["informant"], "place": "grapeseed"},
        {"id": "collar", "kind": "prop", "source": "spawn", "tags": ["clue"], "place": "paleto_forest", "deferred": True, "revealed_by": "farmer"},
        {"id": "dog", "kind": "ped", "source": "spawn", "tags": ["animal"], "place": "paleto_forest", "deferred": True, "revealed_by": "collar"},
    ],
    "start": "s1",
    "stages": [
        {"id": "s1", "timeout": 30,
         "objectives": [{"id": "o1", "kind": "success", "formula": {"f": "conversed", "args": ["farmer"]}},
                        {"id": "f1", "kind": "failure", "formula": {"f": "dead", "args": ["farmer"]}}],
         "policies": [{"role": "nathan", "cap": "follow_player", "consented": True}],
         "on_success": "s2", "on_failure": "END_CONCLUDED", "on_timeout": "END_CONCLUDED"},
        {"id": "s2", "timeout": 30,
         "objectives": [{"id": "o2", "kind": "success", "formula": {"f": "interacted", "args": ["collar"]}},
                        {"id": "f2", "kind": "failure", "formula": {"f": "player_wasted"}}],
         "policies": [{"role": "nathan", "cap": "follow_player", "consented": True}],
         "on_success": "s3", "on_failure": "END_FAILURE", "on_timeout": "END_CONCLUDED"},
        {"id": "s3", "timeout": 20,
         "objectives": [{"id": "o3", "kind": "success", "formula": {"f": "together", "args": ["player", "dog"]}},
                        {"id": "f3", "kind": "failure", "formula": {"f": "dead", "args": ["dog"]}}],
         "policies": [{"role": "nathan", "cap": "follow_player", "consented": True},
                      {"role": "dog", "cap": "gm_flee", "args": {"from": "player"}}],
         "on_success": "END_SUCCESS", "on_failure": "END_FAILURE", "on_timeout": "END_CONCLUDED"},
    ],
    "accommodations": [{"threat": {"role_lost": "farmer"}, "then": [{"do": "spawn", "role": "collar"},
                                                                    {"do": "speak_beat", "beat": "find_it_ourselves"},
                                                                    {"do": "goto", "stage": "s2"}]}],
    "consequences": [{"on": "END_SUCCESS", "effect": "memory_offer", "fact": "found_the_dog"}],
    "budgets": {"steps": 80},
}


def courier_job_x4():
    """X-4 variant: the case is fragile (destroying the van destroys it); a backup ledger
    exists; abandoning the chase concludes gracefully instead of stalling."""
    e = copy.deepcopy(COURIER_JOB)
    e["id"] = "fx-courier-job-x4"
    for r in e["roles"]:
        if r["id"] == "case":
            r["tags"] = ["fragile"]
    e["roles"].append({"id": "ledger", "kind": "item", "source": "spawn", "tags": [], "place": "la_mesa_rail", "deferred": True})
    s2 = e["stages"][1]
    s2["rules"].append({"id": "gave_up", "on": {"held": {"f": "far", "args": ["player", "van", 4]}, "n": 3},
                        "then": [{"do": "speak_beat", "beat": "courier_got_away"}, {"do": "conclude", "outcome": "END_CONCLUDED"}]})
    e["accommodations"].append({"threat": {"role_lost": "case"},
                                "then": [{"do": "spawn", "role": "ledger"},
                                         {"do": "transform", "objective": "o2", "to": {"f": "holding", "args": ["player", "ledger"]}},
                                         {"do": "transform", "objective": "o3", "to": {"and": [{"f": "near", "args": ["player", "safehouse"]},
                                                                                             {"f": "holding", "args": ["player", "ledger"]}]}},
                                         {"do": "speak_beat", "beat": "case_is_gone_get_the_ledger"}]})
    return e


def all_fixtures():
    return [copy.deepcopy(x) for x in (COURIER_JOB, TAIL_THE_WITNESS, LOST_DOG_OUTING)]
