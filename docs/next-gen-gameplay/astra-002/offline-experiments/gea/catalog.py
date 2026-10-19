"""Capability catalog loader (desk census from the ASTRA-002 audit)."""
import json
import os

TIER_ORDER = {"A": 0, "B": 1, "C": 2, "D": 3, "X": 9}

# Validation modes: the highest evidence tier each mode may compile against.
#  accepted: only GTA-observed capabilities (A)
#  play:     LSA source exists (<= B) -- still needs GTA acceptance per capability
#  lab:      anything with a real native/RPH member (<= C) -- isolated lab plugin only
#  bridge:   additionally Essential-internal APIs (D) -- requires an Essential adapter
MODE_MAX_TIER = {"accepted": "A", "play": "B", "lab": "C", "bridge": "D"}

_HERE = os.path.dirname(os.path.abspath(__file__))


def load_catalog(path=None):
    with open(path or os.path.join(_HERE, "capability_catalog.json"), encoding="utf8") as fh:
        doc = json.load(fh)
    cat = {
        "doc": doc,
        "fluents": {f["id"]: f for f in doc["fluents"]},
        "policies": {p["id"]: p for p in doc["actorPolicies"]},
        "staging": {s["id"]: s for s in doc["staging"]},
        "presentation": {p["id"]: p for p in doc["presentation"]},
    }
    # Fluents used by the abstract world but derived from catalog fluents.
    # 'holding' and 'far' are compositions of catalog sensors (held_item / near);
    # they inherit the weakest tier of their parts.
    cat["fluents"].setdefault("holding", {"id": "holding", "tier": "C", "derived_from": ["held_item", "pickup_collected"], "strength": "medium"})
    cat["fluents"].setdefault("far", {"id": "far", "tier": "A", "derived_from": ["near"], "strength": "strong"})
    cat["fluents"].setdefault("together", {"id": "together", "tier": "A", "derived_from": ["near"], "strength": "strong"})
    cat["fluents"].setdefault("timer_elapsed", {"id": "timer_elapsed", "tier": "A", "derived_from": [], "strength": "strong"})
    return cat


def tier_ok(tier, mode):
    return TIER_ORDER[tier] <= TIER_ORDER[MODE_MAX_TIER[mode]]
