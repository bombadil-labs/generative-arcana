"""Byrne major-1 — PSYCHO KILLER (station: club).

Canon: "The voice in your head, self-observation taken to extreme. A mirror reflecting a
face that's slightly off, eyes watching eyes, the doubling of consciousness."

A dark club. A man stands too close to a mirror; the mirror answers with the real
reflection (Cycles glass, like the water in Once in a Lifetime — the doubling is physics).
Side-on camera holds both of them: eyes watching eyes.

  python core/blender/runner.py projects/byrne/psycho_killer.py projects/byrne/out/psycho
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bstage import BStage  # noqa: E402
from bsculpt import Builder  # noqa: E402
from mpfb_body import mpfb_figure  # noqa: E402

st = BStage(ground_color=(14, 13, 15), ground_size=200)      # the club's dark floor


def mirror():
    b = Builder("mirror")
    glass = b.block((0.0, 1.05, 0.0), (0.06, 2.1, 1.3), (210, 214, 220), roughness=0.02)
    # a dielectric reflects ~4% head-on (the water only worked at grazing Fresnel) —
    # a MIRROR is metal
    bsdf = glass.data.materials[0].node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = 1.0
    b.block((0.0, 1.05, 0.0), (0.02, 2.2, 1.42), (30, 26, 22), roughness=0.7)   # the frame
    b.anchor("center", (0.0, 1.05))
    b.anchor("base", (0.0, 0.0))
    return b.finish(skeleton=None, grains=[], droop=0.0, coherence=0.95)


glass = st.place(mirror, at=(1.05, 0.0), z=0.0, rot_z=0.22)

# the man, inches from his own face — arms starting to rise, head pushed forward
fig = st.place(mpfb_figure, at=(0.0, 0.0), z=0.0, rot_z=0.0,
               body_color=(105, 108, 116),
               clothes=[("male_casualsuit01", (110, 114, 124))],
               hair=("short02", (42, 38, 40)),
               spine=0.18, head_tilt=0.35,
               l_arm=(0.55, 1.35), r_arm=(0.6, 1.4),
               l_leg=(-0.1, -0.02), r_leg=(0.12, 0.04))

st.emphasize(fig)
st.attend(st.anchor_world(fig, "head"), polarity=-1)        # the voice sinks IN
st.moon = (0.7, 0.22)

st.sky_cfg = dict(
    top=(8, 8, 10), mid=(20, 18, 22),                        # club darkness
    orb=None, horizon=None,
    grade=(1.04, 0.98, 1.0),
    mist_color=(46, 36, 40),
    aerial=dict(start=20.0, end=160.0, strength=0.35, color=(30, 24, 28)),
)
st.mist_cfg = dict(rise=0.6, peak=0.92, strength=0.18, cap=0.08)

# a mirror shows what the light shows it: the key must hit the MIRROR-FACING side of
# the man, or the glass reflects only club-darkness. Hot red key from beside the glass,
# cold rim from behind him for the profile edge.
st.sun((0.75, -0.45, 0.35), color=(1.0, 0.58, 0.46), energy=3.4, angle=0.5)
st.sun((-0.7, -0.25, -0.4), color=(0.42, 0.5, 0.85), energy=1.1, angle=0.6)
st.world_light((0.1, 0.08, 0.1), 1.2)

# over the shoulder INTO the mirror — the only grammar that holds both of them:
# his back-profile in frame, his face answering from the glass
st.camera(pos=(-1.9, 1.5, 2.3), target=(0.8, 1.15, -0.4), kind="PERSP", focal=42)

out_dir = sys.argv[sys.argv.index("--") + 1]
st.render(out_dir, w=340, h=510)
