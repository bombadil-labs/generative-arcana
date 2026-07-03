"""Byrne minors — four abstract scenes, one per suit, staged by canon.

The direction-plane payoff: SUIT picks engine + stock, RANK drives knobs (a Three is
sparse and forming; a Nine would be dense and fulfilled), STATION sets the light.

  python core/blender/runner.py projects/byrne/minors.py <out_dir> <card>
  cards: structures3 | rivers3 | curiosity6 | dance3
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bstage import BStage  # noqa: E402
from bsculpt import Builder  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:]
out_dir, card = args[0], args[1]


def structures3():
    """Three of Structures (hall): 'Three architectural elements forming initial
    structure, categories beginning to cohere' — two elements meeting, one still apart."""
    st = BStage(ground_color=(168, 166, 160), ground_size=200)
    b = Builder("elements")
    b.capsule((-0.5, 0.0, 0.0), (-0.5, 1.5, 0.0), 0.16, 0.14, (150, 150, 148))   # column
    b.block((0.15, 1.42, 0.0), (1.6, 0.16, 0.3), (140, 142, 146), rot_z=0.08)    # beam, landing
    b.block((0.78, 0.55, 0.0), (0.22, 1.1, 0.3), (150, 150, 148), rot_z=0.0)     # pier
    b.block((1.9, 0.3, 0.6), (0.9, 0.6, 0.5), (144, 144, 142), rot_z=0.5)        # the apart one
    b.anchor("chest", (0.1, 1.0))
    b.anchor("base", (0.0, 0.0))
    el = b.finish(skeleton=None, grains=[], droop=0.0, coherence=0.95)
    st.placements.append(el)
    st.emphasize(el)
    st.attend((0.15, 1.42, 0.0), polarity=1)
    st.moon = (0.5, 0.2)
    st.sky_cfg = dict(top=(190, 192, 194), mid=(214, 214, 210), orb=None, horizon=None,
                      grade=(1.0, 1.0, 1.0), mist_color=(200, 200, 200),
                      aerial=dict(start=30.0, end=200.0, strength=0.2, color=(200, 202, 202)))
    st.mist_cfg = dict(rise=0.5, peak=0.9, strength=0.05, cap=0.03)
    st.sun((-0.5, -0.7, 0.3), color=(1.0, 0.98, 0.95), energy=2.6, angle=1.2)   # flat hall light
    st.world_light((0.3, 0.3, 0.3), 1.0)
    st.camera(pos=(3.4, 2.2, 3.2), target=(0.5, 0.8, 0.0), kind="PERSP", focal=42)
    return st


def rivers3():
    """Three of Rivers (stadium): 'Three streams weaving together, polyrhythmic
    notation, the pattern becoming complex and visible' — braids from above."""
    st = BStage(ground_color=(66, 52, 40), ground_size=300)          # dark earth
    b = Builder("streams")
    t = np.linspace(0, 1, 40)
    for (phase, amp, col, wd) in ((0.0, 0.55, (196, 168, 120), 0.16),
                                  (2.09, 0.55, (176, 138, 96), 0.13),
                                  (4.19, 0.55, (208, 186, 150), 0.10)):
        pts = [(3.0 * (tt - 0.5) * 2.4, 0.06, float(np.sin(tt * np.pi * 3 + phase) * amp))
               for tt in t]
        for a, c in zip(pts[:-1], pts[1:]):
            b.capsule(a, c, wd, wd, col, roughness=0.85)
    b.anchor("chest", (0.0, 0.1))
    b.anchor("base", (0.0, 0.0))
    el = b.finish(skeleton=None, grains=[], droop=0.0, coherence=0.9)
    st.placements.append(el)
    st.emphasize(el)
    st.attend((0.0, 0.1, 0.0), polarity=1)
    st.moon = (0.5, 0.25)
    st.sky_cfg = dict(top=(120, 100, 78), mid=(160, 138, 108), orb=None, horizon=None,
                      grade=(1.03, 1.0, 0.94), mist_color=(140, 120, 96),
                      aerial=dict(start=30.0, end=260.0, strength=0.3, color=(150, 130, 104)))
    st.mist_cfg = dict(rise=0.5, peak=0.9, strength=0.08, cap=0.04)
    st.sun((-0.4, -0.75, 0.3), color=(1.0, 0.92, 0.78), energy=2.8, angle=0.5)
    st.world_light((0.2, 0.17, 0.14), 1.0)
    st.camera(pos=(0.0, 5.2, 4.4), target=(0.0, 0.0, -0.4), kind="PERSP", focal=40)  # aerial
    return st


def curiosity6():
    """Six of Curiosity (headphones): 'Question marks in new arrangement, conversation
    restored with more depth' — two big marks facing each other, four small between."""
    st = BStage(ground_color=(228, 220, 190), ground_size=200)       # warm paper ground

    def qmark(b, cx, cy, s, col, flip=1.0):
        # the hook: an arc of chained capsules; the dot: a sphere
        for i in range(9):
            a0 = -0.75 * np.pi + i * (1.25 * np.pi / 9)
            a1 = -0.75 * np.pi + (i + 1) * (1.25 * np.pi / 9)
            b.capsule((cx + flip * np.cos(a0) * 0.32 * s, cy + 0.52 * s + np.sin(a0) * 0.32 * s, 0.0),
                      (cx + flip * np.cos(a1) * 0.32 * s, cy + 0.52 * s + np.sin(a1) * 0.32 * s, 0.0),
                      0.075 * s, 0.075 * s, col)
        b.capsule((cx, cy + 0.2 * s, 0.0), (cx, cy + 0.34 * s, 0.0), 0.075 * s, 0.07 * s, col)
        b.sphere((cx, cy, 0.0), 0.085 * s, col)

    b = Builder("marks")
    qmark(b, -0.62, 0.35, 1.0, (216, 168, 40))            # the yellow asker
    qmark(b, 0.62, 0.35, 1.0, (74, 138, 198), flip=-1.0)  # the sky-blue answerer
    for (x, y, s, col) in ((-0.3, 1.35, 0.45, (208, 92, 60)), (0.3, 1.42, 0.4, (86, 160, 96)),
                           (-0.1, 0.02, 0.35, (86, 160, 96)), (0.14, -0.04, 0.32, (208, 92, 60))):
        qmark(b, x, y, s, col, flip=1.0 if x < 0 else -1.0)
    b.anchor("chest", (0.0, 0.8))
    b.anchor("base", (0.0, 0.0))
    el = b.finish(skeleton=None, grains=[], droop=0.0, coherence=0.9)
    st.placements.append(el)
    st.emphasize(el)
    st.attend((0.0, 0.9, 0.0), polarity=1)
    st.moon = (0.5, 0.2)
    st.sky_cfg = dict(top=(150, 190, 220), mid=(226, 224, 200), orb=None, horizon=None,
                      grade=(1.02, 1.0, 0.96), mist_color=(220, 214, 190),
                      aerial=dict(start=30.0, end=200.0, strength=0.15, color=(220, 216, 196)))
    st.mist_cfg = dict(rise=0.5, peak=0.9, strength=0.04, cap=0.02)
    st.sun((-0.45, -0.65, 0.4), color=(1.0, 0.97, 0.9), energy=2.9, angle=0.9)
    st.world_light((0.3, 0.3, 0.28), 1.1)
    st.camera(pos=(0.0, 1.0, 5.2), target=(0.0, 0.78, 0.0), kind="PERSP", focal=50)
    return st


def dance3():
    """Three of Dance (civic square): 'Three dancers finding formation, three bodies one
    rhythm' — the same move, phase-shifted, in triangle formation."""
    from mpfb_body import mpfb_figure
    st = BStage(ground_color=(52, 40, 38), ground_size=300)
    poses = [
        dict(l_arm=(0.6, 1.0), r_arm=(1.0, 2.2), l_leg=(-0.45, -0.2), r_leg=(0.5, 0.15),
             spine=0.1, head_tilt=0.3, airborne=0.1),
        dict(l_arm=(1.0, 2.2), r_arm=(0.6, 1.0), l_leg=(0.5, 0.15), r_leg=(-0.45, -0.2),
             spine=-0.1, head_tilt=-0.3, airborne=0.04),
        dict(l_arm=(0.8, 1.6), r_arm=(0.8, 1.6), l_leg=(-0.3, -0.1), r_leg=(0.35, 0.1),
             spine=0.05, head_tilt=0.15, airborne=0.16),
    ]
    suits = [(150, 60, 48), (196, 120, 44), (170, 84, 90)]           # warm reds/oranges
    spots = [(-0.05, 0.0, 0.9, 0.1), (0.9, 0.0, -0.55, -0.15), (-0.95, 0.0, -0.5, 0.2)]
    figs = []
    for (pose, col, (x, y, z, rz)) in zip(poses, suits, spots):
        figs.append(st.place(mpfb_figure, at=(x, y), z=z, rot_z=rz,
                             clothes=[("male_casualsuit01", col)],
                             hair=("short03", (36, 32, 32)), **pose))
    st.emphasize(*figs)
    st.attend((0.0, 1.0, 0.0), polarity=1)
    st.moon = (0.5, 0.22)
    st.sky_cfg = dict(top=(30, 22, 26), mid=(88, 48, 40), orb=None, horizon=None,
                      grade=(1.06, 0.98, 0.9), mist_color=(90, 56, 44),
                      aerial=dict(start=25.0, end=200.0, strength=0.35, color=(80, 50, 42)))
    st.mist_cfg = dict(rise=0.6, peak=0.92, strength=0.15, cap=0.07)
    st.sun((-0.6, -0.5, 0.4), color=(1.0, 0.72, 0.5), energy=3.4, angle=0.4)     # heat
    st.sun((0.7, -0.2, -0.4), color=(0.9, 0.5, 0.3), energy=1.2, angle=0.6)
    st.world_light((0.14, 0.09, 0.08), 1.0)
    st.camera(pos=(3.4, 1.3, 2.6), target=(0.0, 0.95, 0.1), kind="PERSP", focal=40)
    return st


SCENES = {"structures3": structures3, "rivers3": rivers3,
          "curiosity6": curiosity6, "dance3": dance3}
st = SCENES[card]()
st.render(out_dir, w=340, h=510)
