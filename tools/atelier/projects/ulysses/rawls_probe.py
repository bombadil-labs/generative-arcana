"""The Rawls probe: a seeded RANDOM street-drop, rendered wherever it lands. No cherry-picking.

Behind the veil of ignorance, any point in the city must hold. Each round renders several of
these with fresh seeds; the journal records the verdicts honestly.

  python core/blender/runner.py projects/ulysses/rawls_probe.py <out_dir> <seed>
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bstage import BStage  # noqa: E402
from dublin_blender import person  # noqa: E402
import dublin_set as D  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:]
out_dir = args[0]
seed = int(args[1]) if len(args) > 1 else 1
district = args[2] if len(args) > 2 else None
rng = np.random.default_rng(seed)

# district-identification mode: fixed drop points, random gaze — "do you know where you are?"
DISTRICTS = {
    "monto":   ((243.0, -225.0), (1.0, 0.0), 8.0),        # tenement court, north inner city
    "merrion": ((245.0, 412.0), (0.924, 0.382), 11.0),    # the Georgian squares, SE
    "coombe":  ((-647.0, 502.0), (0.996, 0.086), 8.0),    # Liberties: cottage roofline, spire beyond
    "amiens":  ((455.0, -100.0), (0.0, -1.0), 10.0),      # Amiens St station approach
    "westland": ((410.0, 235.0), (0.0, -1.0), 10.0),      # Westland Row approach
    "broadstone": ((-480.0, -450.0), (0.0, -1.0), 10.0),  # Broadstone approach
    "kingsbridge": ((-1350.0, 140.0), (0.0, -1.0), 10.0), # Kingsbridge approach
    "wellington": ((-2440.0, -240.0), (-0.83, -0.55), 12.0),   # Phoenix Park, the obelisk
    "harcourt": ((-60.0, 755.0), (0.0, -1.0), 10.0),           # Harcourt St approach
}

st = BStage(ground_color=(52, 66, 62), ground_size=3500)
city = {}
city["land"] = D.place_terrain(st)
for name in ("pillar", "gpo", "custom_house", "four_courts", "st_georges", "trinity",
             "sw_spires", "transport", "fabric", "churches", "institutions", "eccles",
             "furniture", "bridges", "quays", "loop_line", "wellington", "tenements",
             "infill"):
    city[name] = st.place(D.LANDMARKS[name])

# the drop: a random point on a random principal (or a named district point), random gaze
if district and district in DISTRICTS:
    (px, pz), (ux, uz), width = DISTRICTS[district]
    name = district
    t = 0.5
else:
    pts, spacing, name, width = D.PRINCIPALS[int(rng.integers(0, len(D.PRINCIPALS)))]
    si = int(rng.integers(0, len(pts) - 1))
    a, c = pts[si], pts[si + 1]
    t = float(rng.uniform(0.15, 0.85))
    px = a[0] + (c[0] - a[0]) * t
    pz = a[1] + (c[1] - a[1]) * t
    ex, ez = c[0] - a[0], c[1] - a[1]
    L = float(np.hypot(ex, ez))
    ux, uz = ex / L, ez / L
gaze = 1 if rng.random() < 0.5 else -1
# district drops are diagnostic: stand centre-street, don't hug a wall
lateral = 0.0 if district else float(rng.uniform(-width / 3, width / 3))
nx, nz = -uz, ux
cx = px + nx * lateral
cz = pz + nz * lateral
cx, cz = D.OCC.nearest_free(cx, cz, r=1.4)     # never spawn inside a wall

# a person dropped on a street looks ALONG the open street, not into the wall beside them:
# among the street axis and its reverse (then all 8 headings as fallback), pick the gaze
# with the longest clear sightline
def sightline(hx, hz):
    d = 2.0
    while d < 60.0:
        if not D.OCC.free(cx + hx * d, cz + hz * d, r=1.0):
            return d
        d += 2.0
    return 60.0

cands = [(ux * gaze, uz * gaze), (-ux * gaze, -uz * gaze)]
cands += [(np.cos(a), np.sin(a)) for a in np.linspace(0, 2 * np.pi, 8, endpoint=False)]
best = max(cands, key=lambda h: sightline(*h))
if sightline(ux * gaze, uz * gaze) < 14.0:      # only override a blocked gaze
    gx_, gz_ = best
else:
    gx_, gz_ = ux * gaze, uz * gaze

# a couple of passers-by so the drop isn't a ghost town by construction
for k in range(2):
    wx = px + ux * gaze * float(rng.uniform(15, 45)) + nx * float(rng.uniform(-width / 3, width / 3))
    wz = pz + uz * gaze * float(rng.uniform(15, 45)) + nz * float(rng.uniform(-width / 3, width / 3))
    st.place(person, at=(wx, D.terrain_height(wx, wz)), z=wz, rot_z=float(rng.uniform(0, 6.28)))

st.sky_cfg = dict(
    top=(124, 134, 140), mid=(166, 168, 158),
    orb=None, horizon=None,
    grade=(1.01, 1.0, 0.97),
    mist_color=(142, 134, 122),
    aerial=dict(start=70.0, end=700.0, strength=0.58, color=(150, 140, 126)),   # coal haze
)
st.mist_cfg = dict(rise=0.8, peak=0.98, strength=0.3, cap=0.12)
st.sun((-0.6, -0.5, 0.3), color=(1.0, 0.93, 0.8), energy=2.7, angle=0.4)
st.world_light((0.15, 0.16, 0.17), 1.0)

st.camera(pos=(cx, D.terrain_height(cx, cz) + 1.68, cz),
          target=(cx + gx_ * 60, D.terrain_height(px, pz) + 3.0, cz + gz_ * 60),
          kind="PERSP", focal=32)

print(f"RAWLS DROP seed={seed}: street={name} t={t:.2f} at ({cx:.0f},{cz:.0f}) gaze={'+' if gaze>0 else '-'}u")
st.render(out_dir, w=340, h=510)
