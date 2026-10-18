#!/usr/bin/env python3
"""ASTRA-001 offline probe P1 -- material-aware penetration model sanity check.

NOT a GTA test. Pure offline physics/calibration exercise run in a sandbox.

Model: Poncelet-type resisting force  F = A * (sigma + beta*rho*v^2)
  semi-infinite depth   P = m/(2*A*beta*rho) * ln(1 + beta*rho*v0^2/sigma)
  residual after t      v(t)^2 = (v0^2 + s)*exp(-2*A*beta*rho*t/m) - s,  s = sigma/(beta*rho)
Ductile plates use a plugging-energy ballistic limit: E_bl = k * sigma_u * A * t.

Calibration: fit ONE parameter (sigma) per material to FM 3-06.11 Table 7-3
(7.62-mm ball, 100 m column). Then PREDICT, out of sample, 5.56-mm and .50-cal
outcomes that FM 3-06.11 states in prose, and report pass/fail.
"""
import math, json

def A_of(d): return math.pi*d*d/4

# Projectiles (mass kg, diameter m). Velocities at range are approximations
# (documented as assumptions, not measured): M80 ~780 m/s @100 m, ~710 @200 m;
# M855 ~880 m/s @50 m; M33 .50 ball ~790 m/s @200 m.
PROJ = {
  '7.62_ball_M80': dict(m=0.0095, d=0.00782),
  '5.56_M855':     dict(m=0.0040, d=0.00570),
  '.50_M33_ball':  dict(m=0.0420, d=0.01295),
  '9mm_FMJ':       dict(m=0.0080, d=0.00901),
}
BETA = 0.5  # nose/shape factor for ogive FMJ (assumption; held fixed for all)

# Target materials: density (kg/m^3) known/assumed; sigma fitted.
MAT_RHO = {'concrete':2300.0,'pine':500.0,'dry_sand':1600.0,'cinder_block':1000.0,
           'brick':1900.0,'gypsum_board':700.0,'plywood':550.0}

def depth(proj, v0, rho, sigma, beta=BETA):
    m, A = proj['m'], A_of(proj['d'])
    return m/(2*A*beta*rho)*math.log(1+beta*rho*v0*v0/sigma)

def residual(proj, v0, rho, sigma, t, beta=BETA):
    m, A = proj['m'], A_of(proj['d'])
    s = sigma/(beta*rho)
    v2 = (v0*v0+s)*math.exp(-2*A*beta*rho*t/m)-s
    return math.sqrt(v2) if v2 > 0 else 0.0

def fit_sigma(proj, v0, rho, target_depth):
    lo, hi = 1e3, 5e9
    for _ in range(200):
        mid = math.sqrt(lo*hi)
        if depth(proj, v0, rho, mid) > target_depth: lo = mid
        else: hi = mid
    return math.sqrt(lo*hi)

IN = 0.0254
# FM 3-06.11 Table 7-3, 7.62-mm single ball round, 100 m column (units: inches).
CAL = {'concrete':2*IN,'pine':18*IN,'dry_sand':4.5*IN,'cinder_block':10*IN}
v762_100 = 780.0
sig = {k: fit_sigma(PROJ['7.62_ball_M80'], v762_100, MAT_RHO[k], d) for k,d in CAL.items()}
# Materials without a 7.62 depth in FM: brick bounded by "5.56 stopped by a brick veneer";
# gypsum/plywood bounded by "Sheetrock/thin wood paneling are no protection".
sig['brick'] = 0.6*sig['concrete']          # assumption: brick weaker than concrete
sig['gypsum_board'] = 5e6                     # assumption (order of magnitude)
sig['plywood'] = sig['pine']                  # assumption

out = {'assumptions':{'beta':BETA,'v762_100m':v762_100}, 'fitted_sigma_MPa':{k:round(v/1e6,2) for k,v in sig.items()}}
checks = []
def chk(name, ok, detail): checks.append({'check':name,'pass':bool(ok),'detail':detail})

# Out-of-sample prediction 1: 5.56 is stopped by 2-in unreinforced concrete (<50 m).
d556c = depth(PROJ['5.56_M855'], 880.0, MAT_RHO['concrete'], sig['concrete'])
chk('5.56 stopped by 2in concrete (FM prose)', d556c < 2*IN, f'predicted depth {d556c/IN:.2f} in')
# Prediction 2: .50 ball penetrates ~14 in of sand at 200 m.
d50s = depth(PROJ['.50_M33_ball'], 790.0, MAT_RHO['dry_sand'], sig['dry_sand'])
chk('.50 ~14in sand @200m (FM prose; within +-35%)', abs(d50s/IN-14)/14 < 0.35, f'predicted {d50s/IN:.1f} in')
# Prediction 3: 5.56 penetrates a 3/8-in mild steel door (plugging energy model).
t, su, k = 0.375*IN, 400e6, 3.0
Ebl = k*su*A_of(PROJ['5.56_M855']['d'])*t
E556 = 0.5*PROJ['5.56_M855']['m']*830.0**2
chk('5.56 perforates 3/8in mild steel (FM table 7-2)', E556 > Ebl, f'E={E556:.0f} J vs E_bl~{Ebl:.0f} J (k=3 assumption)')
# Prediction 4: 5.56 perforates several 12.7 mm gypsum boards (interior partition).
v = 880.0; layers = 0
while layers < 20:
    v = residual(PROJ['5.56_M855'], v, MAT_RHO['gypsum_board'], sig['gypsum_board'], 0.0127)
    if v <= 0: break
    layers += 1
chk('5.56 passes >=4 gypsum boards ("Sheetrock no protection")', layers >= 4, f'{layers} boards before stop')
# Prediction 5: 5.56 stopped by brick veneer (~9 cm) at <50 m.
d556b = depth(PROJ['5.56_M855'], 880.0, MAT_RHO['brick'], sig['brick'])
chk('5.56 stopped by brick veneer ~9cm (FM prose)', d556b < 0.09, f'predicted depth {d556b*100:.1f} cm (brick sigma is an assumption)')
# Informative: 9mm through an interior stud wall (2 x 12.7 mm gypsum), residual velocity.
v9 = residual(PROJ['9mm_FMJ'], 360.0, MAT_RHO['gypsum_board'], sig['gypsum_board'], 0.0127)
v9 = residual(PROJ['9mm_FMJ'], v9, MAT_RHO['gypsum_board'], sig['gypsum_board'], 0.0127)
out['informative'] = {'9mm_after_2_gypsum_boards_mps': round(v9,1),
                      '5.56_concrete_depth_in': round(d556c/IN,2), '.50_sand_depth_in': round(d50s/IN,1)}
out['checks'] = checks
out['passed'] = sum(c['pass'] for c in checks); out['total'] = len(checks)
print(json.dumps(out, indent=2))

# ---- Variant B: same-range calibration for the .50 sand check -------------
# FM 7.62 sand depths are non-monotonic with range (5, 4.5, 7 in at 25/100/200 m),
# i.e. yaw/stability effects the Poncelet model does not represent. Re-fit sand
# on the 200 m point (7 in, ~710 m/s assumed) and re-predict .50 at 200 m.
sig_sand_200 = fit_sigma(PROJ['7.62_ball_M80'], 710.0, MAT_RHO['dry_sand'], 7*IN)
d50s_B = depth(PROJ['.50_M33_ball'], 790.0, MAT_RHO['dry_sand'], sig_sand_200)
print(json.dumps({'variant_B_same_range': {
   'sand_sigma_MPa': round(sig_sand_200/1e6,2),
   '.50_sand_depth_in': round(d50s_B/IN,1),
   'pass_within_35pct_of_14in': abs(d50s_B/IN-14)/14 < 0.35}}, indent=2))
