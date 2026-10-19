"""Objective monitors over an evidence stream (X-5).

The proposed evidence ladder (04 §5): PROPOSED -> ACCEPTED -> STAGED -> ACTIVE ->
OBSERVED -> ACHIEVED. Only authenticated native sensor samples (or ACT
PHYSICALLY_COMPLETED receipts for activity fluents) can move an objective to ACHIEVED,
and only when they agree with the activation stamp (host run, world epoch, entity
incarnation), are monotonic, physically plausible, post-activation and held.

Baseline monitors show what each guard buys:
  M0 any_true        - first 'true' from any source (model text, acks, sensors)
  M1 receipts        - trusts handler acknowledgements / command acceptance
  M2 single_native   - first authenticated native 'true' sample, no other guards
  M3 evidence_ladder - the proposed contract
"""

V_MAX = 90.0  # m/s; faster apparent motion between samples is treated as a teleport/handle swap


class Stamp:
    def __init__(self, host, epoch, incarnation, t_activate):
        self.host, self.epoch, self.incarnation, self.t_activate = host, epoch, incarnation, t_activate


def m0_any_true(events, stamp):
    for e in events:
        if e.get("value") is True:
            return e["t"]
    return None


def m1_receipts(events, stamp):
    for e in events:
        if e["source"] in ("handler_ack", "act_receipt", "model_text") and e.get("value") is True:
            return e["t"]
        if e["source"] == "native_sensor" and e.get("value") is True:
            return e["t"]
    return None


def m2_single_native(events, stamp):
    for e in events:
        if e["source"] == "native_sensor" and e.get("authenticated") and e.get("value") is True:
            return e["t"]
    return None


def m3_evidence_ladder(events, stamp, hold_n=3, hold_ms=500, max_gap_ms=600):
    run = 0
    first_t = None
    last_t = -1
    last_pos = None
    last_pos_t = None
    for e in events:
        if e["source"] != "native_sensor" or not e.get("authenticated"):
            continue  # model text, acks and unauthenticated frames never count
        if e["host"] != stamp.host or e["epoch"] != stamp.epoch:
            run, first_t = 0, None
            continue
        if e["incarnation"] != stamp.incarnation:
            run, first_t = 0, None  # handle reuse / replaced entity
            continue
        if e["t"] <= last_t:
            continue  # duplicate or out-of-order delivery
        if e["t"] < stamp.t_activate:
            last_t = e["t"]
            continue  # no credit for pre-activation state
        gap = e["t"] - last_t if last_t >= 0 else 0
        pos = e.get("pos")
        implausible = False
        if pos is not None and last_pos is not None and last_pos_t is not None:
            dt = max(1e-3, (e["t"] - last_pos_t) / 1000.0)
            d = ((pos[0] - last_pos[0]) ** 2 + (pos[1] - last_pos[1]) ** 2) ** 0.5
            implausible = d / dt > V_MAX
        if pos is not None:
            last_pos, last_pos_t = pos, e["t"]
        last_t = e["t"]
        if implausible or gap > max_gap_ms or not e.get("value"):
            run, first_t = 0, None
            if implausible or not e.get("value"):
                continue
        if e.get("value"):
            run += 1
            first_t = e["t"] if first_t is None else first_t
            if run >= hold_n and e["t"] - first_t >= hold_ms:
                return e["t"]
    return None


MONITORS = {"M0_any_true": m0_any_true, "M1_receipts": m1_receipts,
            "M2_single_native": m2_single_native, "M3_evidence_ladder": m3_evidence_ladder}
