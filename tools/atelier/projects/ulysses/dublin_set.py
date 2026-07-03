"""The Dublin Set — reusable 1904 city model (see DUBLIN_SET.md).

World scale 1 unit = 1.75 m. Set coords: x = east, y = up, z = SOUTH; origin O'Connell Bridge.
Water (Liffey/docks/bay) is the stage's ground box; land is raised platforms. Landmarks are
individual builders with anchors; terrace fill is procedural per precinct.

Usage (inside a card's scene script):
    from dublin_set import build_city
    city = build_city(st, precincts=("river", "docklands"))
    st.attend(st.anchor_world(city["custom_house"], "dome_top"), polarity=-1)
"""

import os

import numpy as np

from bsculpt import Builder

M = 1 / 1.75          # metres → units

# R13 contract: fabric checks OCC before placing. Toggle for A/B density measurement.
FABRIC_OCC_CHECK = os.environ.get("FABRIC_OCC_CHECK", "1") != "0"

GRANITE = (104, 100, 94)
GRANITE_D = (78, 76, 72)
STONE = (92, 89, 84)
STONE_D = (72, 70, 66)
BRICK = (96, 74, 62)
BRICK_D = (80, 60, 52)
COPPER = (88, 106, 92)     # weathered dome copper
LIGHTHOUSE_RED = (128, 52, 42)
LAND = (76, 74, 68)

NET_A, NET_B = 0.65, -0.65


class _Occupancy:
    """Coarse 2D footprint index over the city core: generators mark, invaders check,
    probes query. Doubles as the collision/nav seed for game export."""

    def __init__(self, x0=-1300, x1=1600, z0=-1500, z1=1400, cell=3.0):
        self.x0, self.z0, self.cell = x0, z0, cell
        self.nx = int((x1 - x0) / cell)
        self.nz = int((z1 - z0) / cell)
        self.grid = np.zeros((self.nz, self.nx), dtype=bool)
        self.roads = np.zeros((self.nz, self.nx), dtype=bool)   # roadways: no building stands here

    def _ix(self, x, z):
        return int((x - self.x0) / self.cell), int((z - self.z0) / self.cell)

    def _stamp(self, grid, cx, cz, w, d, ang=0.0):
        """Rasterize the ROTATED rect (not its AABB — the AABB smears diagonals into fat
        staircase bands; R17 measured that eating 40% of kerbside fabric)."""
        ca, sa = float(np.cos(ang)), float(np.sin(ang))
        hw, hd = w / 2, d / 2
        aw = abs(hw * ca) + abs(hd * sa)
        ad = abs(hw * sa) + abs(hd * ca)
        i0, j0 = self._ix(cx - aw, cz - ad)
        i1, j1 = self._ix(cx + aw, cz + ad)
        i0, j0 = max(0, i0), max(0, j0)
        i1, j1 = min(self.nx - 1, i1), min(self.nz - 1, j1)
        if i1 < i0 or j1 < j0:
            return
        xs = self.x0 + (np.arange(i0, i1 + 1) + 0.5) * self.cell - cx
        zs = self.z0 + (np.arange(j0, j1 + 1) + 0.5) * self.cell - cz
        X, Z = np.meshgrid(xs, zs)
        U = X * ca - Z * sa                     # along-axis (b.block rot_z convention)
        V = X * sa + Z * ca                     # across-axis
        m = (np.abs(U) <= hw + self.cell * 0.5) & (np.abs(V) <= hd + self.cell * 0.5)
        grid[j0:j1 + 1, i0:i1 + 1] |= m

    def mark(self, cx, cz, w, d, ang=0.0):
        self._stamp(self.grid, cx, cz, w, d, ang)

    def mark_road(self, cx, cz, w, d, ang=0.0):
        self._stamp(self.roads, cx, cz, w, d, ang)

    def on_road(self, x, z, r=1.2):
        i0, j0 = self._ix(x - r, z - r)
        i1, j1 = self._ix(x + r, z + r)
        if i0 < 0 or j0 < 0 or i1 >= self.nx or j1 >= self.nz:
            return False
        return bool(self.roads[j0:j1 + 1, i0:i1 + 1].any())

    def free(self, x, z, r=1.2, grid=None):
        g = self.grid if grid is None else grid
        i0, j0 = self._ix(x - r, z - r)
        i1, j1 = self._ix(x + r, z + r)
        if i0 < 0 or j0 < 0 or i1 >= self.nx or j1 >= self.nz:
            return True
        return not g[j0:j1 + 1, i0:i1 + 1].any()

    def snapshot(self):
        """Freeze the current marks. A generator that both marks and checks must check
        against the snapshot (the world BEFORE it started), or it censors itself."""
        self._snap = self.grid.copy()
        return self._snap

    def nearest_free(self, x, z, r=1.2, max_r=36.0, step=2.5):
        if self.free(x, z, r):
            return (x, z)
        rr = step
        while rr <= max_r:
            for a in np.linspace(0, 2 * np.pi, 12, endpoint=False):
                qx, qz = x + rr * np.cos(a), z + rr * np.sin(a)
                if self.free(qx, qz, r):
                    return (qx, qz)
            rr += step
        return (x, z)


OCC = _Occupancy()


def _net(b, grains, i0, angle):
    for i in range(i0, Builder._next_index[0]):
        grains.append((i, (0.0, 0.0), (float(np.cos(angle)), float(-np.sin(angle)))))


def _landmark(name):
    return Builder(name), []


# ── land ─────────────────────────────────────────────────────────────────────

def land_platforms(st):
    """North and south banks (+1.7 u over water), river gap ~30 u, bay open east of +750."""
    b = Builder("land")
    b.block((-100, 0.85, -450), (1700, 1.7, 860), LAND)     # north bank
    b.block((-150, 0.85, 460), (1600, 1.7, 880), LAND)      # south bank
    b.block((1050, 0.85, 620), (900, 1.7, 600), LAND)       # Ringsend / strand side
    b.anchor("base", (0, 0))
    return st.place(lambda: b.finish(skeleton=None, grains=[], droop=0.0, coherence=0.9))


# ── landmarks ────────────────────────────────────────────────────────────────

def nelsons_pillar():
    b, g = _landmark("pillar")
    x, z = 0 * M, -350 * M
    i0 = Builder._next_index[0]
    b.block((x, 1.7 + 2.0, z), (6.5, 4.0, 6.5), GRANITE)                       # plinth
    b.capsule((x, 5.7, z), (x, 1.7 + 36.0 * M * 1.75 / 1.75 + 15.5, z), 1.15, 0.95, GRANITE)  # shaft ~ to 21u
    b.block((x, 22.0, z), (2.2, 1.3, 2.2), GRANITE_D)                          # capital
    b.capsule((x, 22.6, z), (x, 24.2, z), 0.35, 0.28, STONE_D)                 # the Admiral
    _net(b, g, i0, NET_A)
    b.anchor("top", (x, 24.2)); b.anchor("base", (x, 1.7))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


def custom_house():
    b, g = _landmark("custom_house")
    x, z = 450 * M, -100 * M
    i0 = Builder._next_index[0]
    b.block((x, 1.7 + 4.6, z), (60.0, 9.2, 14.0), STONE)                       # long front
    b.block((x, 1.7 + 10.5, z), (12.0, 4.5, 12.0), STONE_D)                    # attic block
    b.block((x, 1.7 + 13.8, z), (7.0, 3.0, 7.0), STONE)                        # drum
    b.sphere((x, 1.7 + 17.5, z), 3.3, COPPER)                                  # the dome
    b.capsule((x, 1.7 + 20.6, z), (x, 1.7 + 22.0, z), 0.3, 0.12, STONE)        # Commerce
    _net(b, g, i0, NET_B)
    b.anchor("dome_top", (x, 1.7 + 22.0)); b.anchor("base", (x, 1.7))
    b.anchor("top", (x, 1.7 + 22.0))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


def four_courts():
    b, g = _landmark("four_courts")
    x, z = -700 * M, -150 * M
    i0 = Builder._next_index[0]
    b.block((x, 1.7 + 4.5, z), (50.0, 9.0, 14.0), STONE)
    # the drum-dome is a broad colonnaded rotunda — the river's great swelling (Audit 1 #12)
    b.block((x, 1.7 + 11.9, z), (14.5, 5.8, 14.5), STONE_D)
    b.block((x, 1.7 + 12.2, z), (15.3, 3.2, 15.3), STONE)                      # colonnade band
    b.sphere((x, 1.7 + 17.6, z), 6.2, COPPER)                                  # the copper dome
    b.capsule((x, 1.7 + 23.6, z), (x, 1.7 + 25.2, z), 0.5, 0.3, STONE)         # lantern
    _net(b, g, i0, NET_A)
    b.anchor("dome_top", (x, 1.7 + 25.2)); b.anchor("base", (x, 1.7))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


def st_georges():
    b, g = _landmark("st_georges")
    x, z = -100 * M, -900 * M
    i0 = Builder._next_index[0]
    b.block((x, 1.7 + 5.0, z), (12.0, 10.0, 16.0), STONE)
    b.block((x, 1.7 + 13.0, z), (5.0, 6.0, 5.0), STONE_D)                      # tower
    b.capsule((x, 1.7 + 16.0, z), (x, 1.7 + 34.0, z), 2.1, 0.08, STONE)        # 60 m spire
    _net(b, g, i0, NET_B)
    b.anchor("spire_top", (x, 1.7 + 34.0)); b.anchor("base", (x, 1.7))
    b.anchor("top", (x, 1.7 + 34.0))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


def trinity_campanile():
    b, g = _landmark("trinity")
    x, z = 150 * M, 350 * M
    i0 = Builder._next_index[0]
    b.block((x, 1.7 + 3.5, z), (5.0, 7.0, 5.0), STONE)
    b.block((x, 1.7 + 8.6, z), (3.4, 3.2, 3.4), STONE_D)
    b.sphere((x, 1.7 + 12.4, z), 1.9, STONE)                                   # cupola
    _net(b, g, i0, NET_A)
    b.anchor("top", (x, 1.7 + 14.3)); b.anchor("base", (x, 1.7))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


def southwest_spires():
    """Christ Church tower + St Patrick's spire — the SW skyline pair."""
    b, g = _landmark("sw_spires")
    i0 = Builder._next_index[0]
    x1, z1 = -950 * M, 500 * M
    b.block((x1, 1.7 + 6.0, z1), (10.0, 12.0, 10.0), STONE_D)                  # Christ Church
    b.block((x1, 1.7 + 14.5, z1), (5.0, 5.0, 5.0), STONE)
    x2, z2 = -900 * M, 900 * M
    # St Patrick's: 43 m tower + spire to ~68 m — the old city's tallest, the Liberties' compass
    b.block((x2, 1.7 + 12.3, z2), (9.0, 24.6, 9.0), STONE)
    b.capsule((x2, 1.7 + 24.6, z2), (x2, 1.7 + 38.9, z2), 1.8, 0.07, STONE_D)
    _net(b, g, i0, NET_B)
    b.anchor("top", (x2, 1.7 + 38.9)); b.anchor("base", (x1, 1.7))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


def south_wall_and_lighthouse():
    """The Great South Wall running east into the bay; Poolbeg light at its end."""
    b, g = _landmark("south_wall")
    i0 = Builder._next_index[0]
    b.block((2225, 0.65, 215), (1790, 1.3, 5.8), GRANITE)                      # the wall
    b.block((3120, 2.0, 215), (3.4, 1.4, 3.4), GRANITE_D)                      # light base
    b.capsule((3120, 2.6, 215), (3120, 12.0, 215), 1.5, 1.1, LIGHTHOUSE_RED)   # tower
    b.sphere((3120, 12.6, 215), 0.9, (30, 30, 32))                             # lantern
    _net(b, g, i0, NET_A)
    b.anchor("light_top", (3120, 13.2)); b.anchor("wall_root", (1350, 1.3))
    b.anchor("base", (2225, 0.0)); b.anchor("top", (3120, 13.2))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


def north_wall_dock():
    """Deep-sea berth on the North Wall quay — Forger's pier."""
    b, g = _landmark("dock")
    i0 = Builder._next_index[0]
    b.block((610, 1.0, -22), (44.0, 2.0, 9.0), GRANITE)                        # quay apron
    b.block((610, 2.25, -18.4), (44.0, 0.5, 0.7), GRANITE_D)                   # river-edge coping
    for k in range(5):
        b.block((594 + k * 8, 2.68, -18.3), (0.38, 0.36, 0.38), (40, 38, 36))  # bollards (~0.6 m)
    _net(b, g, i0, NET_B)
    b.anchor("edge", (610, 2.0, -18.6))
    b.anchor("base", (610, 0.0)); b.anchor("top", (610, 2.5))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.9, aged=True)


def terrace_fill(rng_seed=7, precincts=("river",)):
    """Procedural Georgian terrace masses along the quays and Sackville Street."""
    b, g = _landmark("terraces")
    rng = np.random.default_rng(rng_seed)
    ROWS = {
        "river_north": [((-750, -60), (700, -60), 22)],
        "river_south": [((-780, 65), (520, 65), 20)],
        "sackville": [((-15, -420), (-15, -120), 8)],
        "docklands_north": [((720, -70), (1180, -80), 9)],
        "docklands_south": [((640, 90), (1150, 100), 8)],
    }
    rows = []
    for key in precincts:
        rows += ROWS.get(key, [])
    if "river" in precincts:      # back-compat alias
        rows += ROWS["river_north"] + ROWS["river_south"] + ROWS["sackville"]
    for (a, bpt, n) in rows:
        for k in range(n):
            t = (k + 0.5) / n
            x = a[0] + (bpt[0] - a[0]) * t + float(rng.uniform(-3, 3))
            z = a[1] + (bpt[1] - a[1]) * t + float(rng.uniform(-2, 2))
            hgt = float(rng.uniform(6.5, 8.6))
            wdt = float(rng.uniform(4.0, 6.5))
            i0 = Builder._next_index[0]
            b.block((x, 1.7 + hgt / 2, z), (wdt, hgt, 4.5),
                    BRICK if rng.random() < 0.55 else (STONE if rng.random() < 0.5 else BRICK_D))
            _net(b, g, i0, NET_A if k % 2 == 0 else NET_B)
    b.anchor("base", (0, 1.7))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.9, aged=True)


def warehouse_row():
    """Brick transit sheds along the North Wall behind the dock apron."""
    b, g = _landmark("warehouses")
    rng = np.random.default_rng(11)
    for k in range(5):
        x = 566 + k * 40 + float(rng.uniform(-2, 2))
        hgt = float(rng.uniform(4.2, 5.4))
        i0 = Builder._next_index[0]
        b.block((x, 1.7 + hgt / 2, -33.0), (17.0, hgt, 11.0), BRICK_D if k % 2 else BRICK)
        b.block((x, 1.7 + hgt + 0.5, -33.0), (17.0, 1.0, 5.0), (60, 48, 44))   # roof ridge
        _net(b, g, i0, NET_A if k % 2 == 0 else NET_B)
    b.anchor("base", (640, 1.7)); b.anchor("top", (640, 1.7 + 6.4))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.9, aged=True)


def threemaster():
    """A tall ship, sails brailed up — 'moving through the air high spars of a threemaster'
    (Proteus). Local space: hull along x, bow toward -x (homing upstream); waterline y=0."""
    b, g = _landmark("threemaster")
    HULL = (30, 28, 26)
    MAST = (42, 38, 33)
    i0 = Builder._next_index[0]
    b.block((0.0, 0.9, 0.0), (19.0, 1.8, 4.0), HULL)                           # hull
    b.block((-8.2, 1.35, 0.0), (4.5, 0.9, 2.6), HULL)                          # bow taper
    b.block((7.6, 2.05, 0.0), (3.6, 0.7, 3.0), HULL)                           # aft house
    b.capsule((-9.8, 1.9, 0.0), (-14.5, 3.1, 0.0), 0.16, 0.07, MAST)           # bowsprit
    for (mx, mh) in ((-5.0, 15.5), (0.6, 17.0), (5.8, 13.5)):                  # fore/main/mizzen
        b.capsule((mx, 1.8, 0.0), (mx, 1.8 + mh, 0.0), 0.17, 0.06, MAST)
        for (fy, yl) in ((0.34, 6.4), (0.58, 5.0), (0.80, 3.4)):               # yards
            yy = 1.8 + mh * fy
            b.capsule((mx, yy, -yl / 2), (mx, yy, yl / 2), 0.075, 0.075, MAST)
    _net(b, g, i0, NET_A)
    b.anchor("masthead", (0.6, 18.8))
    b.anchor("base", (0.0, 0.0)); b.anchor("top", (0.6, 18.8))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.9)


# ── assembly ─────────────────────────────────────────────────────────────────

LANDMARKS = {
    "pillar": nelsons_pillar,
    "custom_house": custom_house,
    "four_courts": four_courts,
    "st_georges": st_georges,
    "trinity": trinity_campanile,
    "sw_spires": southwest_spires,
    "south_wall": south_wall_and_lighthouse,
    "dock": north_wall_dock,
    "warehouses": warehouse_row,
    "threemaster": threemaster,
}


def build_city(st, precincts=("river", "docklands"), landmarks=None):
    """Place the set into a stage; returns {name: placement} incl. 'terraces' and 'land'."""
    city = {}
    city["land"] = land_platforms(st)
    for name in (landmarks or LANDMARKS.keys()):
        city[name] = st.place(LANDMARKS[name])
    city["terraces"] = st.place(lambda: terrace_fill(precincts=precincts))
    return city


# ── P1: terrain & water ──────────────────────────────────────────────────────
# The land as a heightfield: city bowl, rise west toward Phoenix Park, the Dublin/Wicklow
# ridge south, Howth head NE (true ~170 m), Killiney SE, the Sandycove rock rise; Dublin Bay
# as a depressed crescent (Sandymount stays shallow — the strand emerges); the Liffey carved
# along its real bends. `terrain_height(x, z)` is queryable so placements sit ON the land.

RIVER_PTS = [(-3400, -100), (-2500, -160), (-1800, 20), (-1100, -60), (-500, -25),
             (0, -15), (450, -25), (900, -35), (1350, -45), (1900, -40)]


def _gauss2(X, Z, cx, cz, sx, sz):
    return np.exp(-((X - cx) / sx) ** 2 - ((Z - cz) / sz) ** 2)


def _sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _dist_polyline(X, Z, pts):
    d = np.full_like(X, np.inf)
    for a, b in zip(pts[:-1], pts[1:]):
        ex, ez = b[0] - a[0], b[1] - a[1]
        L2 = ex * ex + ez * ez or 1e-9
        t = np.clip(((X - a[0]) * ex + (Z - a[1]) * ez) / L2, 0, 1)
        d = np.minimum(d, np.sqrt((X - (a[0] + t * ex)) ** 2 + (Z - (a[1] + t * ez)) ** 2))
    return d


def _coast_noise(X, Z, seed=5, cell=520.0, octaves=3):
    """Deterministic value noise for ragged shorelines."""
    total = np.zeros_like(X)
    amp = 1.0
    for o in range(octaves):
        c = cell / (2 ** o)
        rng = np.random.default_rng(seed + o)
        gw = int(12000 / c) + 3
        gh = int(11000 / c) + 3
        g = rng.random((gh, gw))
        fx = (X + 4000) / c
        fz = (Z + 4600) / c
        ix = np.clip(fx.astype(int), 0, gw - 2)
        iz = np.clip(fz.astype(int), 0, gh - 2)
        tx = fx - ix
        tz = fz - iz
        n = (g[iz, ix] * (1 - tx) * (1 - tz) + g[iz, ix + 1] * tx * (1 - tz)
             + g[iz + 1, ix] * (1 - tx) * tz + g[iz + 1, ix + 1] * tx * tz)
        total += (n - 0.5) * amp
        amp *= 0.5
    return total


def _dist_seg(X, Z, a, b):
    ex, ez = b[0] - a[0], b[1] - a[1]
    L2 = ex * ex + ez * ez or 1e-9
    t = np.clip(((X - a[0]) * ex + (Z - a[1]) * ez) / L2, 0, 1)
    return np.sqrt((X - (a[0] + t * ex)) ** 2 + (Z - (a[1] + t * ez)) ** 2)


def _height(X, Z):
    h = np.full_like(X, 1.9, dtype=np.float64)                     # coastal plain
    h += 16.0 * _sstep(-800.0, -2400.0, X)                          # rise west
    h += 150.0 * _gauss2(X, Z, 300, 5400, 2800, 1500)               # Wicklow ridge (S bg)
    h += 98.0 * _gauss2(X, Z, 5300, -2300, 1050, 750)               # Howth head (peninsula)
    h += 8.0 * _gauss2(X, Z, 4400, -2150, 620, 230)                 # Sutton neck / isthmus
    h += 55.0 * _gauss2(X, Z, 6500, 4500, 450, 320)                 # Killiney/Dalkey
    h += 6.5 * _gauss2(X, Z, 6150, 3900, 260, 200)                  # Sandycove rise
    e = ((X - 3700) / 2900) ** 2 + ((Z - 550) / 2150) ** 2
    e += _coast_noise(X, Z) * 0.34                                  # ragged shoreline
    h -= 15.0 * _sstep(1.15, 0.72, e)                               # the bay
    # the open Irish Sea east of the Howth→Dalkey coastal diagonal
    sea_edge = X - (6050.0 + 0.16 * (Z + 2000.0)) + _coast_noise(X, Z, seed=9) * 260.0
    h -= 15.0 * _sstep(-150.0, 300.0, sea_edge)
    h += 3.5 * _gauss2(X, Z, 1900, 950, 900, 450)                   # Sandymount flats
    h += 2.4 * np.exp(-(_dist_seg(X, Z, (2600, -950), (4150, -1520)) / 95.0) ** 2)  # Bull Island
    h -= 11.0 * np.exp(-(_dist_polyline(X, Z, RIVER_PTS) / 26.0) ** 2)   # the Liffey
    # the canals: Grand (south belt) and Royal (north belt), ~15 m wide
    GRAND = [(1450, 520), (900, 860), (200, 1050), (-500, 1120), (-1200, 1050), (-1900, 900)]
    ROYAL = [(700, -200), (400, -700), (-100, -1050), (-800, -1250), (-1600, -1300)]
    h -= 5.5 * np.exp(-(_dist_polyline(X, Z, GRAND) / 10.5) ** 2)
    h -= 5.5 * np.exp(-(_dist_polyline(X, Z, ROYAL) / 10.5) ** 2)
    return h


def kingstown_harbour():
    """Kingstown (Dun Laoghaire) harbour: the two great granite arms embracing the water."""
    b, g = _landmark("kingstown")
    i0 = Builder._next_index[0]
    b.block((5760, 0.9, 3130), (700.0, 1.8, 7.0), GRANITE, rot_z=0.55)     # west pier
    b.block((6290, 0.9, 3260), (620.0, 1.8, 7.0), GRANITE, rot_z=-0.62)    # east pier
    b.block((6015, 2.2, 2870), (4.0, 2.6, 4.0), GRANITE_D)                 # east pier light base
    _net(b, g, i0, NET_A)
    b.anchor("base", (6000, 1.8)); b.anchor("top", (6015, 3.5))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


def terrain_height(x, z):
    return float(_height(np.array([[x]], dtype=np.float64), np.array([[z]], dtype=np.float64))[0, 0])


def place_terrain(st, cell=18.0, x0=-3500, x1=7500, z0=-4200, z1=5600):
    import bpy
    from bsculpt import S2B
    nx = int((x1 - x0) / cell) + 1
    nz = int((z1 - z0) / cell) + 1
    xs = np.linspace(x0, x1, nx)
    zs = np.linspace(z0, z1, nz)
    X, Z = np.meshgrid(xs, zs)
    H = _height(X, Z)

    verts = []
    for j in range(nz):
        for i in range(nx):
            verts.append(S2B(X[j, i], H[j, i], Z[j, i]))
    faces = []
    for j in range(nz - 1):
        for i in range(nx - 1):
            a = j * nx + i
            faces.append((a, a + 1, a + nx + 1, a + nx))

    me = bpy.data.meshes.new("terrain")
    me.from_pydata(verts, [], faces)
    me.update()
    for poly in me.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new("terrain", me)
    bpy.context.scene.collection.objects.link(obj)

    # color by height + slope: strand sand, grass, high heather/rock
    gz, gx = np.gradient(H, cell)
    slope = np.sqrt(gz ** 2 + gx ** 2)
    col = np.zeros((nz, nx, 3))
    col[:] = (0.30, 0.30, 0.27)                                      # city/field grey-green
    col = np.where((H < 0.9)[..., None], (0.56, 0.51, 0.40), col)    # strand sand
    col = np.where(((H >= 6) & (H < 45))[..., None], (0.24, 0.29, 0.21), col)   # grass hills
    col = np.where((H >= 45)[..., None], (0.31, 0.28, 0.26), col)    # heather/rock
    col = np.where((slope > 0.55)[..., None], (0.34, 0.33, 0.31), col)
    ca = me.color_attributes.new(name="part_color", type="FLOAT_COLOR", domain="POINT")
    flat = col.reshape(-1, 3)
    for i in range(len(verts)):
        ca.data[i].color = (*flat[i], 1.0)

    idx = Builder._next_index[0]
    Builder._next_index[0] += 1
    obj.pass_index = idx
    import bpy as _b
    m = _b.data.materials.new("terrain_mat")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.95
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "part_color"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    attr_i = nt.nodes.new("ShaderNodeAttribute")
    attr_i.attribute_name = "pidx"
    aov = nt.nodes.new("ShaderNodeOutputAOV")
    aov.aov_name = "pidx"
    nt.links.new(attr_i.outputs["Fac"], aov.inputs["Value"])
    me.materials.append(m)
    pa = me.attributes.new(name="pidx", type="FLOAT", domain="POINT")
    pa.data.foreach_set("value", np.full(len(verts), idx, dtype=np.float32))

    b = Builder("terrain_info")
    info = {"name": "terrain", "root": obj, "span": (idx, idx + 1), "anchors": {},
            "skeleton": None, "grains": [], "droop": 0.0, "coherence": 0.9, "aged": False}
    st.placements.append(info)
    return info


def bridges():
    """Grattan, O'Connell, Butt bridges — slab decks with parapets across the channel."""
    b, g = _landmark("bridges")
    for (x, wdt) in ((-450, 8.0), (0, 30.0), (380, 7.0)):   # O'Connell ~ as wide as long
        yq = 2.1
        b.block((x, yq - 0.4, -20 if x == 0 else -20), (wdt, 1.0, 62.0), GRANITE)
        b.block((x - wdt / 2 + 0.4, yq + 0.55, -20), (0.5, 0.9, 60.0), GRANITE_D)
        b.block((x + wdt / 2 - 0.4, yq + 0.55, -20), (0.5, 0.9, 60.0), GRANITE_D)
    b.anchor("base", (0, 2.1))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


def quay_walls():
    """Granite walls lining the carved channel through the city reach."""
    b, g = _landmark("quays")
    pts = [q for q in RIVER_PTS if -1300 <= q[0] <= 1500]
    for a, c in zip(pts[:-1], pts[1:]):
        ex, ez = c[0] - a[0], c[1] - a[1]
        L = float(np.hypot(ex, ez))
        ang = float(np.arctan2(-ez, ex))
        mx, mz = (a[0] + c[0]) / 2, (a[1] + c[1]) / 2
        nxv, nzv = -ez / L, ex / L
        for side in (-31, 31):
            i0 = Builder._next_index[0]
            b.block((mx + nxv * side, 0.85, mz + nzv * side), (L + 6, 3.0, 2.2), GRANITE_D, rot_z=ang)
            _net(b, g, i0, NET_A)
    b.anchor("base", (0, 2.1))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


def martello_sandycove():
    """The squat granite drum on its rise at Sandycove — Telemachus's tower."""
    b, g = _landmark("martello")
    x, z = 6150, 3900
    base = terrain_height(x, z)
    i0 = Builder._next_index[0]
    b.capsule((x, base - 0.5, z), (x, base + 6.4, z), 3.5, 3.3, GRANITE_D)
    b.block((x, base + 6.8, z), (7.4, 0.9, 7.4), GRANITE)          # parapet ring (squared)
    _net(b, g, i0, NET_A)
    b.anchor("top", (x, base + 7.4)); b.anchor("base", (x, base))
    b.anchor("gun_platform", (x, base + 7.3, z))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


LANDMARKS["bridges"] = bridges
LANDMARKS["quays"] = quay_walls
LANDMARKS["martello"] = martello_sandycove

def loop_line():
    """The 1891 railway viaduct east of Butt Bridge — the beloved eyesore of the river."""
    b, g = _landmark("loop_line")
    i0 = Builder._next_index[0]
    IRON = (38, 46, 44)
    b.block((432, 4.6, -20), (9.0, 1.2, 62.0), IRON)                  # elevated deck
    b.block((428.4, 6.1, -20), (0.7, 2.2, 60.0), IRON)                # lattice girders
    b.block((435.6, 6.1, -20), (0.7, 2.2, 60.0), IRON)
    for pz in (-42, -20, 2):
        b.block((432, 1.8, pz), (7.0, 5.6, 2.2), GRANITE_D)           # river piers
    _net(b, g, i0, NET_B)
    b.anchor("base", (432, 2.0)); b.anchor("top", (432, 7.2))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


def wellington():
    """The Wellington Testimonial in Phoenix Park — 62 m, taller than the Pillar."""
    b, g = _landmark("wellington")
    x, z = -2600, -350
    base = terrain_height(x, z)
    i0 = Builder._next_index[0]
    b.block((x, base + 2.5, z), (16.0, 5.0, 16.0), GRANITE)
    b.block((x, base + 6.0, z), (9.0, 2.0, 9.0), GRANITE_D)
    b.capsule((x, base + 7.0, z), (x, base + 35.4, z), 3.0, 0.55, GRANITE)   # tapering obelisk
    _net(b, g, i0, NET_A)
    b.anchor("top", (x, base + 35.4)); b.anchor("base", (x, base))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


LANDMARKS["kingstown"] = kingstown_harbour
LANDMARKS["loop_line"] = loop_line
LANDMARKS["wellington"] = wellington


# ── P2 + P3: street network & building fabric ────────────────────────────────
# Principal streets as real-ish polylines; side streets branch perpendicular; row-houses line
# every street as continuous strips with chimney ridge-lines; parish churches at corners;
# institutional set-pieces. The streets themselves are the GAPS between the fabric.

PRINCIPALS = [
    # (polyline, side-street spacing (0 = none), name, width in units)
    ([(-750, -52), (700, -52)], 0, "north quay", 11.0),
    ([(-780, 58), (520, 58)], 0, "south quay", 11.0),
    ([(8, -30), (8, -430)], 80, "sackville", 28.0),          # ~49 m: widest street in Europe
    ([(30, 25), (55, 180), (45, 430)], 90, "westmoreland_grafton", 13.0),
    ([(55, 185), (-340, 245)], 75, "dame", 14.0),
    ([(-385, -25), (-380, -390)], 85, "capel", 9.0),
    ([(-5, -235), (-345, -258)], 70, "henry_mary", 8.5),
    ([(35, -185), (360, -125)], 75, "talbot", 9.0),
    ([(150, -95), (95, -430), (-40, -720)], 95, "gardiner", 12.0),   # wide Georgian
    ([(-120, -385), (-330, -730)], 90, "dorset_eccles", 11.0),
    ([(-345, 245), (-810, 310)], 80, "thomas", 10.0),
    ([(70, 300), (420, 540)], 90, "baggot", 10.0),
    ([(100, 350), (390, 470)], 85, "merrion", 11.0),
    ([(150, -110), (430, -330)], 90, "summerhill", 10.0),
    ([(-430, 330), (-720, 560)], 95, "coombe", 8.0),
]
SIDE_W = 8.0

ROW_H = (6.2, 8.6)
ROW_DEPTH = 9.0
STREET_W = 13.0
DETAIL_ZONES = [(8, -140, 190), (-160, -682, 130)]      # Sackville probe · Eccles St

WINDOW = (26, 28, 34)
SILL = (150, 146, 138)
DOOR_COLS = ((52, 34, 30), (30, 40, 52), (70, 30, 28), (24, 30, 26))


def _in_zone(x, z):
    for (zx, zz, r) in DETAIL_ZONES:
        if (x - zx) ** 2 + (z - zz) ** 2 < r * r:
            return True
    return False


def _facade(b, g, rng, mx, mz, base, seg_l, hgt, ang, ux, uz, nx, nz, side, width=STREET_W):
    """Window/door rhythm on the street face of one row segment. Georgian bay ≈ 3.4 m."""
    face_off = ROW_DEPTH / 2 + 0.08
    fx = mx + nx * (-side) * face_off
    fz = mz + nz * (-side) * face_off
    n_bay = max(2, int(seg_l / 1.95))
    for k in range(n_bay):
        t = (k + 0.5) / n_bay - 0.5
        wx = fx + ux * t * seg_l * 0.94
        wz = fz + uz * t * seg_l * 0.94
        # two storeys of windows
        for wy in (base + 3.3, base + 5.3):
            if wy > base + hgt - 1.2:
                continue
            b.block((wx, wy, wz), (1.0, 1.55, 0.08), WINDOW, roughness=0.25, rot_z=ang)
            b.block((wx, wy - 0.9, wz), (1.2, 0.14, 0.24), SILL, rot_z=ang)
        # ground floor: door or window
        if k % 3 == 1:
            b.block((wx, base + 1.25, wz), (1.05, 2.5, 0.2), DOOR_COLS[k % 4], rot_z=ang)
            b.block((wx, base + 2.62, wz), (1.2, 0.35, 0.22), SILL, rot_z=ang)   # fanlight band
        else:
            b.block((wx, base + 1.55, wz), (1.0, 1.7, 0.08), WINDOW, roughness=0.25, rot_z=ang)
    # curb + pavement strip
    pave_off = width / 2 - 1.2
    b.block((mx - nx * side * (face_off - pave_off) * 0 + nx * (-side) * pave_off,
             base + 0.10, mz + nz * (-side) * pave_off),
            (seg_l, 0.22, 2.3), (128, 124, 116), rot_z=ang)


def social(x, z):
    """1904 social geography: (wealth, north_poverty, liberties, soot), each 0..1.
    SE Georgian squares wealthy; north inner city tall decayed tenements; the Liberties low
    weaver cottages; soot heavy near docks, brewery, and poverty."""
    def gs(cx, cz, sx, sz):
        return float(np.exp(-((x - cx) / sx) ** 2 - ((z - cz) / sz) ** 2))
    wealth = 0.8 * gs(250, 420, 380, 270) + 0.35 * gs(8, -200, 95, 330)
    poverty_n = gs(250, -260, 230, 190) + 0.5 * gs(80, -520, 260, 220)
    liberties = gs(-560, 420, 300, 230)
    soot = 0.5 * gs(820, -30, 420, 220) + 0.65 * liberties + 0.55 * min(1.0, poverty_n)
    return (min(1.0, wealth), min(1.0, poverty_n), min(1.0, liberties), min(1.0, soot))


def _row_along(b, g, rng, a, c, side, gap_at=(), width=STREET_W, shops=False):
    """One continuous row-house strip along segment a→c on the given side (+1/-1)."""
    ex, ez = c[0] - a[0], c[1] - a[1]
    L = float(np.hypot(ex, ez))
    if L < 24:
        return
    ux, uz = ex / L, ez / L
    nx, nz = -uz * side, ux * side
    ang = float(np.arctan2(-ez, ex))
    n_seg = max(1, int(L / 46.0))
    for k in range(n_seg):
        t0 = k / n_seg + 0.06 / n_seg
        t1 = (k + 1) / n_seg - 0.06 / n_seg
        skip = False
        for gt in gap_at:
            if t0 - 0.04 < gt < t1 + 0.04:
                skip = True
        if skip:
            continue
        mx = a[0] + ex * (t0 + t1) / 2 + nx * (width / 2 + ROW_DEPTH / 2)
        mz = a[1] + ez * (t0 + t1) / 2 + nz * (width / 2 + ROW_DEPTH / 2)
        seg_l = L * (t1 - t0)
        hgt = float(rng.uniform(*ROW_H))
        wealth, pov_n, lib, soot = social(mx, mz)
        hgt *= (1.0 + 0.14 * wealth) * (1.0 - 0.38 * lib)
        if pov_n > 0.45:
            hgt *= 1.12                              # tall decayed Georgians of the north side
        base = terrain_height(mx, mz)
        # respect landmarks placed before fabric — but check the PRE-FABRIC snapshot,
        # not the live grid, or rows censor each other (R16: cost 37% of the city)
        if FABRIC_OCC_CHECK and not OCC.free(mx, mz, r=4.0, grid=getattr(OCC, "_snap", None)):
            continue
        if OCC.on_road(mx, mz, r=2.0):               # never stand in a carriageway (R17)
            continue
        c0 = BRICK if rng.random() < 0.6 else (STONE if rng.random() < 0.5 else BRICK_D)
        if wealth > 0.55 and rng.random() < 0.5:
            c0 = (108, 82, 66)                       # well-kept warm brick of the squares
        soot_k = 0.34
        if lib > 0.5:
            # the Liberties: weaver cottages — whitewash and pale render over rubble,
            # grimed but unmistakably NOT brick; the district's material signature
            c0 = [(204, 198, 186), (190, 186, 174), (198, 190, 170),
                  (176, 174, 166)][int(rng.integers(0, 4))]
            soot_k = 0.2
        col = tuple(int(v * (1.0 - soot_k * soot)) for v in c0)
        OCC.mark(mx, mz, seg_l, ROW_DEPTH, ang)
        i0 = Builder._next_index[0]
        floors = max(1 if lib > 0.5 else 2, int(hgt / 2.9))   # cottages are 1–2 storey
        b.block((mx, base + hgt / 2, mz), (seg_l, hgt, ROW_DEPTH),
                col, rot_z=ang, facade=(max(2, int(seg_l / 1.95)), floors))
        b.block((mx, base + hgt + 0.3, mz), (seg_l, 0.6, ROW_DEPTH * 0.92), (66, 68, 73), rot_z=ang)  # slate
        # street-face parapet + party-wall chimney stacks with pots: the Dublin sawtooth
        px_ = mx - nx * (ROW_DEPTH / 2 - 0.22)
        pz_ = mz - nz * (ROW_DEPTH / 2 - 0.22)
        b.block((px_, base + hgt + 0.62, pz_), (seg_l, 0.55, 0.35), col, rot_z=ang)
        n_st = max(2, int(seg_l / 8.5))
        for k in range(n_st):
            t_ = (k + 0.5) / n_st - 0.5
            sxx, szz = mx + ux * seg_l * t_, mz + uz * seg_l * t_
            b.block((sxx, base + hgt + 1.0, szz), (1.7, 1.5, 1.15), (98, 72, 56), rot_z=ang)
            for pot in (-0.42, 0.42):
                qx, qz = sxx + ux * pot, szz + uz * pot
                b.capsule((qx, base + hgt + 1.75, qz), (qx, base + hgt + 2.3, qz),
                          0.14, 0.12, (112, 60, 42))
        if shops and lib < 0.4:
            # commercial ground floor: joinery band + pale fascia (signage) + awnings
            fx = mx - nx * (ROW_DEPTH / 2 + 0.18)
            fz = mz - nz * (ROW_DEPTH / 2 + 0.18)
            JOINERY = ((30, 48, 38), (52, 30, 26), (36, 34, 40), (58, 44, 26))
            b.block((fx, base + 1.6, fz), (seg_l * 0.97, 3.2, 0.35),
                    JOINERY[int(rng.integers(0, 4))], rot_z=ang)
            b.block((fx - nx * 0.2, base + 2.95, fz - nz * 0.2), (seg_l * 0.97, 0.55, 0.12),
                    (196, 188, 170), rot_z=ang)
            n_aw = max(2, int(seg_l / 12))
            for aw in range(n_aw):
                if rng.random() < 0.55:
                    t_ = (aw + 0.5) / n_aw - 0.5
                    ax_, az_ = fx + ux * seg_l * t_, fz + uz * seg_l * t_
                    b.block((ax_ - nx * 0.85, base + 2.7, az_ - nz * 0.85), (3.4, 0.12, 1.5),
                            [(196, 186, 160), (150, 60, 48), (70, 96, 74)][int(rng.integers(0, 3))],
                            rot_z=ang)
        if _in_zone(mx, mz):
            _facade(b, g, rng, mx, mz, base, seg_l, hgt, ang, ux, uz, nx, nz, side, width=width)
        _net(b, g, i0, NET_A if k % 2 == 0 else NET_B)


def _mark_road_along(a, c, width):
    ex, ez = c[0] - a[0], c[1] - a[1]
    L = float(np.hypot(ex, ez))
    if L < 1:
        return
    ang = float(np.arctan2(-ez, ex))
    n = int(L / 5.0) + 1
    for k in range(n + 1):
        t = k / n
        # _stamp axes follow b.block: w = along-street, d = across. Mark 3/4 of the legal
        # width so grid quantization can't eat the rows standing at the kerb.
        OCC.mark_road(a[0] + ex * t, a[1] + ez * t, 6.0, width * 0.75, ang)


SHOP_STREETS = {"sackville", "westmoreland_grafton", "dame", "henry_mary",
                "talbot", "north quay", "south quay"}


def fabric(seed=23):
    """The city's living tissue: principals + perpendicular side streets, rows on both sides.

    Two-pass (R17): first PLAN every street (principals + derived side streets) and mark all
    roadways in OCC.roads — only then place rows. A row segment refuses to stand on any road,
    so side streets can no longer run their rows across another street's carriageway."""
    b, g = _landmark("fabric")
    OCC.snapshot()                    # rows check the pre-fabric world, never each other
    rng = np.random.default_rng(seed)
    plan = []                         # (a, c, width, gaps, shops)
    for (pts, spacing, _name, width) in PRINCIPALS:
        for a, c in zip(pts[:-1], pts[1:]):
            ex, ez = c[0] - a[0], c[1] - a[1]
            L = float(np.hypot(ex, ez))
            ux, uz = ex / L, ez / L
            # side streets branch perpendicular at spacing; record their t for row gaps
            gaps = []
            sides = []
            if spacing:
                s = spacing * 0.7
                while s < L - 30:
                    t = s / L
                    gaps.append(t)
                    sides.append((a[0] + ex * t, a[1] + ez * t, -uz, ux))
                    s += spacing * float(rng.uniform(0.85, 1.25))
            plan.append((a, c, width, tuple(gaps), _name in SHOP_STREETS))
            for (sx, sz, dx, dz) in sides:
                for sgn in (1, -1):
                    ln = float(rng.uniform(90, 210))
                    a2 = (sx + dx * sgn * (width / 2 + 2), sz + dz * sgn * (width / 2 + 2))
                    c2 = (sx + dx * sgn * ln, sz + dz * sgn * ln)
                    plan.append((a2, c2, SIDE_W, (), False))
    for (a, c, width, gaps, shops) in plan:               # roads first, all of them
        _mark_road_along(a, c, width)
    for (a, c, width, gaps, shops) in plan:               # then the rows
        for side in (1, -1):
            _row_along(b, g, rng, a, c, side, gap_at=gaps, width=width, shops=shops)
    b.anchor("base", (0, 1.9))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.9, aged=True)


def parish_churches(seed=31):
    """A scatter of parish churches: nave + tower + small spire, at street-corner-ish spots."""
    b, g = _landmark("churches")
    rng = np.random.default_rng(seed)
    spots = [(-260, -180), (170, -300), (-480, 140), (-620, -240), (300, 240),
             (-180, 420), (240, -520), (-520, -560), (420, 60), (-40, 560)]
    for (x, z) in spots:
        base = terrain_height(x, z)
        ang = float(rng.uniform(-0.4, 0.4))
        i0 = Builder._next_index[0]
        OCC.mark(x, z, 10.0, 20.0, ang)
        b.block((x, base + 4.0, z), (10.0, 8.0, 20.0), STONE_D, rot_z=ang)
        b.block((x, base + 10.0, z - 8), (4.5, 6.0, 4.5), STONE, rot_z=ang)
        b.capsule((x, base + 13.0, z - 8), (x, base + 19.5, z - 8), 1.3, 0.06, STONE_D)
        _net(b, g, i0, NET_B)
    b.anchor("base", (0, 1.9))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


def institutions():
    """Set-piece civic masses: Trinity's two quads, Dublin Castle, the Mansion House."""
    b, g = _landmark("institutions")
    i0 = Builder._next_index[0]
    # Trinity: two hollow courts east of College Green
    for (cx, cz, w, d) in ((150, 310, 90, 60), (255, 320, 80, 55)):
        for (bx, bz, bw, bd) in ((cx, cz - d / 2, w, 10), (cx, cz + d / 2, w, 10),
                                 (cx - w / 2, cz, 10, d), (cx + w / 2, cz, 10, d)):
            b.block((bx, 1.9 + 4.5, bz), (bw, 9.0, bd), STONE)
    b.block((-250, 1.9 + 5.0, 285), (60.0, 10.0, 45.0), STONE_D)      # Dublin Castle mass
    b.block((-235, 1.9 + 11.5, 268), (9.0, 5.0, 9.0), STONE)          # Bedford tower
    b.block((65, 1.9 + 3.5, 395), (22.0, 7.0, 14.0), BRICK)           # Mansion House
    _net(b, g, i0, NET_A)
    b.anchor("base", (150, 1.9))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


def street_furniture():
    """Gas lamps (in detail zones) + tram track pairs on the tram streets."""
    b, g = _landmark("furniture")
    rng = np.random.default_rng(41)
    TRAM_STREETS = ["sackville", "north quay", "westmoreland_grafton"]
    for (pts, spacing, name, width) in PRINCIPALS:
        for a, c in zip(pts[:-1], pts[1:]):
            ex, ez = c[0] - a[0], c[1] - a[1]
            L = float(np.hypot(ex, ez))
            ux, uz = ex / L, ez / L
            nx, nz = -uz, ux
            ang = float(np.arctan2(-ez, ex))
            if name in TRAM_STREETS:
                mx, mz = (a[0] + c[0]) / 2, (a[1] + c[1]) / 2
                base = terrain_height(mx, mz)
                pairs = (-4.5, 4.5) if width > 20 else (0.0,)     # up & down lines on Sackville
                for pc in pairs:
                    for rail in (-0.8, 0.8):
                        off = pc + rail
                        b.block((mx + nx * off, base + 0.06, mz + nz * off),
                                (L, 0.1, 0.22), (44, 44, 46), rot_z=ang)
            # lamps every ~36 u where in a detail zone
            s = 18.0
            while s < L - 10:
                lx, lz = a[0] + ux * s, a[1] + uz * s
                if True:
                    for side in (1, -1):
                        px_ = lx + nx * side * (width / 2 - 0.8)
                        pz_ = lz + nz * side * (width / 2 - 0.8)
                        base = terrain_height(px_, pz_)
                        b.capsule((px_, base, pz_), (px_, base + 3.3, pz_), 0.09, 0.06, (30, 32, 30))
                        b.sphere((px_, base + 3.55, pz_), 0.22, (235, 226, 190), roughness=0.3)
                s += 44.0 * float(rng.uniform(0.9, 1.2))
    b.anchor("base", (8, 1.9))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.95)


LANDMARKS["fabric"] = fabric
LANDMARKS["furniture"] = street_furniture
LANDMARKS["churches"] = parish_churches
LANDMARKS["institutions"] = institutions


def eccles_street():
    """Eccles Street: the quiet terrace off Dorset St. Anchor "bloom_door" = No. 7."""
    b, g = _landmark("eccles")
    rng = np.random.default_rng(7)
    a, c = (-250, -640), (-70, -724)
    ex, ez = c[0] - a[0], c[1] - a[1]
    L = float(np.hypot(ex, ez))
    ang = float(np.arctan2(-ez, ex))
    ux, uz = ex / L, ez / L
    nx, nz = -uz, ux
    for side in (1, -1):
        mx = (a[0] + c[0]) / 2 + nx * side * (STREET_W / 2 + ROW_DEPTH / 2)
        mz = (a[1] + c[1]) / 2 + nz * side * (STREET_W / 2 + ROW_DEPTH / 2)
        base = terrain_height(mx, mz)
        i0 = Builder._next_index[0]
        b.block((mx, base + 3.9, mz), (L, 7.8, ROW_DEPTH), BRICK, rot_z=ang)
        b.block((mx, base + 8.1, mz), (L, 0.7, ROW_DEPTH * 0.92), (66, 68, 73), rot_z=ang)
        b.block((mx, base + 8.7, mz), (L * 0.96, 0.55, 1.1), (104, 76, 60), rot_z=ang)
        _facade(b, g, rng, mx, mz, base, L, 7.8, ang, ux, uz, nx, nz, side)
        _net(b, g, i0, NET_A if side > 0 else NET_B)
    # No. 7: door on the north-side row, ~40% along
    dx = a[0] + ex * 0.4 + nx * (STREET_W / 2 - 0.15)
    dz = a[1] + ez * 0.4 + nz * (STREET_W / 2 - 0.15)
    dbase = terrain_height(dx, dz)
    b.block((dx, dbase + 0.80, dz), (1.0, 1.6, 0.22), (52, 34, 30), rot_z=ang)  # the door (2.8 m w/ fan)
    b.block((dx, dbase + 1.78, dz), (1.05, 0.34, 0.2), (150, 146, 138), rot_z=ang)  # fanlight
    b.block((dx - nx * 0.5, dbase + 0.12, dz - nz * 0.5), (1.6, 0.24, 1.0), (150, 146, 138), rot_z=ang)  # granite step
    for side_r in (1, -1):
        rx = (a[0] + c[0]) / 2 + nx * side_r * (STREET_W / 2 - 1.0)
        rz = (a[1] + c[1]) / 2 + nz * side_r * (STREET_W / 2 - 1.0)
        rb = terrain_height(rx, rz)
        b.block((rx, rb + 0.55, rz), (L * 0.9, 0.08, 0.08), (26, 27, 26), rot_z=ang)   # area rail
    b.anchor("bloom_door", (dx, dbase + 1.1, dz))
    b.anchor("base", (dx, dbase)); b.anchor("top", (dx, dbase + 9.3))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.9, aged=True)


LANDMARKS["eccles"] = eccles_street


def gpo():
    """The General Post Office: long mass, hexastyle portico, pediment — Sackville's west side."""
    b, g = _landmark("gpo")
    x, z = -48, -229
    base = terrain_height(x, z)
    i0 = Builder._next_index[0]
    b.block((x, base + 4.6, z), (24.0, 9.2, 42.0), STONE)                    # main mass
    b.block((x + 13.2, base + 5.6, z), (3.0, 6.4, 26.0), STONE_D)            # portico platform band
    for k in range(6):
        cz = z - 12.5 + k * 5.0
        b.capsule((x + 14.5, base + 1.0, cz), (x + 14.5, base + 7.4, cz), 0.55, 0.5, STONE)
    b.block((x + 14.0, base + 8.4, z), (4.4, 1.9, 28.0), STONE)              # entablature+pediment band
    _net(b, g, i0, NET_B)
    b.anchor("portico", (x + 15, base + 4, z))
    b.anchor("base", (x, base)); b.anchor("top", (x, base + 10.5))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


LANDMARKS["gpo"] = gpo


# ── Round 3: block infill + the social layer ─────────────────────────────────

def block_infill(seed=53):
    """Backland roofscape: mews, returns, yards — the roof-sea inside the blocks."""
    b, g = _landmark("infill")
    rng = np.random.default_rng(seed)
    for (pts, spacing, _name, width) in PRINCIPALS:
        for a, c in zip(pts[:-1], pts[1:]):
            ex, ez = c[0] - a[0], c[1] - a[1]
            L = float(np.hypot(ex, ez))
            ux, uz = ex / L, ez / L
            nx, nz = -uz, ux
            s = 14.0
            while s < L - 12:
                t = s / L
                for side in (1, -1):
                    for _ in range(rng.integers(1, 3)):
                        off = width / 2 + ROW_DEPTH + 4 + float(rng.uniform(2, 24))
                        bx = a[0] + ex * t + nx * side * off + float(rng.uniform(-4, 4))
                        bz = a[1] + ez * t + nz * side * off + float(rng.uniform(-4, 4))
                        base = terrain_height(bx, bz)
                        if base < 1.2:
                            continue                       # water/canal — no roofs in the drink
                        if not OCC.free(bx, bz, r=7.0):
                            continue                       # occupied — no squatting in courts
                        hgt = float(rng.uniform(3.6, 6.4))  # mews lower than street rows
                        w2 = float(rng.uniform(5.0, 13.0))
                        d2 = float(rng.uniform(5.0, 11.0))
                        ang = float(np.arctan2(-ez, ex)) + float(rng.uniform(-0.15, 0.15))
                        i0 = Builder._next_index[0]
                        OCC.mark(bx, bz, w2, d2, ang)
                        b.block((bx, base + hgt / 2, bz), (w2, hgt, d2),
                                BRICK_D if rng.random() < 0.6 else (70, 62, 55), rot_z=ang,
                                facade=(max(1, int(w2 / 2.4)), max(1, int(hgt / 2.9))))
                        b.block((bx, base + hgt + 0.3, bz), (w2, 0.6, d2 * 0.9), (60, 62, 66), rot_z=ang)
                        _net(b, g, i0, NET_A)
                s += 26.0 * float(rng.uniform(0.8, 1.3))
    b.anchor("base", (0, 1.9))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.9, aged=True)


def tenements(seed=61):
    """The north-inner-city tenement belt + the Monto (Nighttown): decayed 4-storey Georgian,
    sooty brick, tight courts — the densest poverty in Europe, and Circe's stage."""
    b, g = _landmark("tenements")
    rng = np.random.default_rng(seed)
    SOOT = (58, 46, 40)
    SOOT_D = (48, 40, 36)
    # the Monto: bounded roughly by Talbot (S) and Gardiner (W) — tight parallel courts
    rows_z = list(range(-160, -330, -26))
    for rz in rows_z:
        x0 = 140 + float(rng.uniform(-6, 6))
        x1 = 370 + float(rng.uniform(-8, 8))
        seg = x0
        while seg < x1:
            ln = float(rng.uniform(18, 42))
            if rng.random() < 0.12:
                seg += ln * 0.5                            # a collapsed gap — decay
                continue
            hgt = float(rng.uniform(8.4, 10.2))            # tall tenement Georgians
            base = terrain_height(seg + ln / 2, rz)
            i0 = Builder._next_index[0]
            OCC.mark(seg + ln / 2, rz, ln, 8.5, 0.0)
            b.block((seg + ln / 2, base + hgt / 2, rz), (ln, hgt, 8.5),
                    SOOT if rng.random() < 0.7 else SOOT_D,
                    facade=(max(2, int(ln / 1.8)), 4))
            b.block((seg + ln / 2, base + hgt + 0.3, rz), (ln, 0.6, 7.6), (52, 54, 58))
            for k in range(max(2, int(ln / 9.0))):        # sooty party-wall stacks
                t_ = (k + 0.5) / max(2, int(ln / 9.0)) - 0.5
                sxx = seg + ln / 2 + ln * t_
                b.block((sxx, base + hgt + 0.95, rz), (1.6, 1.4, 1.1), (66, 52, 44))
                for pot in (-0.4, 0.4):
                    b.capsule((sxx + pot, base + hgt + 1.65, rz),
                              (sxx + pot, base + hgt + 2.15, rz), 0.13, 0.11, (84, 50, 38))
            _net(b, g, i0, NET_B)
            seg += ln + float(rng.uniform(2, 7))
    # what makes a Monto court read as Monto and not a generic terrace street: washing
    # strung wall-to-wall between the rows, and the yard clutter of crowded poverty.
    # Set-level truth, not probe dressing — every court gets it, seen or unseen.
    CLOTH = [(196, 190, 178), (172, 168, 160), (148, 142, 130), (120, 116, 108)]
    for rz0, rz1 in zip(rows_z, rows_z[1:]):
        court_z = (rz0 + rz1) / 2.0
        span = abs(rz0 - rz1) - 8.5                      # facade-to-facade gap
        for _ in range(5):                                # washing lines across the court
            lx = float(rng.uniform(150, 360))
            ly = terrain_height(lx, court_z) + float(rng.uniform(4.2, 6.4))
            b.block((lx, ly, court_z), (0.05, 0.05, span), (110, 104, 96))
            for _ in range(int(rng.integers(3, 7))):      # sheets and shirts on the line
                cz = court_z + float(rng.uniform(-span / 2.6, span / 2.6))
                cw = float(rng.uniform(0.7, 1.6))
                ch = float(rng.uniform(0.9, 1.7))
                b.block((lx, ly - ch / 2 - 0.05, cz),
                        (0.08, ch, cw), CLOTH[int(rng.integers(0, len(CLOTH)))])
        for _ in range(9):                                # yard clutter: barrels, crates, carts
            ox = float(rng.uniform(145, 365))
            oz = court_z + float(rng.uniform(-span / 2.4, span / 2.4))
            oy = terrain_height(ox, oz)
            r = rng.random()
            if r < 0.45:
                b.block((ox, oy + 0.45, oz), (0.7, 0.9, 0.7), (72, 58, 44))     # barrel
            elif r < 0.8:
                b.block((ox, oy + 0.3, oz), (1.1, 0.6, 0.8), (96, 82, 62))      # crate
            else:
                b.block((ox, oy + 0.5, oz), (2.2, 0.25, 1.1), (84, 70, 54))     # handcart bed
                b.block((ox - 0.8, oy + 0.4, oz), (0.12, 0.8, 0.8), (60, 50, 42))
    b.anchor("base", (250, 1.9))
    b.anchor("monto", (250, 2.0, -240.0))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.88, aged=True)


def transport(seed=71):
    """Audit 2 (transport historian): the four rail termini, tram standards + overhead wire,
    DUTC double-deck trams at the Pillar terminus, and a jaunting-car rank. Gates and veins."""
    b, g = _landmark("transport")
    rng = np.random.default_rng(seed)
    i0 = Builder._next_index[0]
    IRON = (36, 40, 40)
    SHED = (56, 60, 64)
    CREAM = (206, 194, 166)

    def terminus(x, z, w, front_h, shed_d, shed_h, stone, tower=False):
        base = terrain_height(x, z)
        OCC.mark(x, z, w, shed_d + 8.0, 0.0)
        OCC.mark(x, z + 26.0, w, 50.0, 0.0)              # forecourt + approach: keep them clear
        b.block((x, base + front_h / 2, z), (w, front_h, 7.0), stone,
                facade=(max(3, int(w / 3.2)), max(2, int(front_h / 3.4))))
        b.block((x, base + front_h + 0.4, z), (w, 0.8, 6.4), (60, 62, 66))
        # a terminus announces itself: entrance arcade + string course + cornice
        for off in (-w * 0.22, 0.0, w * 0.22):
            b.block((x + off, base + 2.6, z + 3.3), (3.0, 5.2, 0.7), (24, 24, 26))
        b.block((x, base + front_h * 0.62, z + 3.35), (w, 0.35, 0.5), (146, 142, 132))
        b.block((x, base + front_h - 0.25, z + 3.4), (w * 1.02, 0.5, 0.7), (150, 146, 136))
        sz = z - 3.5 - shed_d / 2                       # train shed behind (northward)
        b.block((x, base + shed_h * 0.62, sz), (w * 0.86, shed_h * 0.76, shed_d), SHED)
        b.block((x, base + shed_h + 0.2, sz), (w * 0.4, 0.9, shed_d * 0.96), (44, 48, 52))
        if tower:                                        # the Amiens St campanile
            b.block((x - w / 2 + 2.6, base + 15.0 / 2, z), (5.0, 15.0, 5.0), stone)
            b.block((x - w / 2 + 2.6, base + 15.6, z), (3.4, 1.2, 3.4), (60, 62, 66))

    # the city's gates — sited to the set's geography, Loop Line ends aligned
    terminus(455, -165, 40, 10.0, 50, 9.5, STONE, tower=True)      # Amiens St (GNR)
    terminus(410, 165, 30, 9.0, 40, 10.0, STONE_D)                 # Westland Row (DSER)
    terminus(-480, -520, 34, 12.0, 45, 9.0, GRANITE_D)             # Broadstone (MGWR)
    terminus(-1350, 70, 44, 11.0, 40, 9.5, STONE)                  # Kingsbridge (GSWR)
    terminus(-60, 690, 26, 8.5, 34, 8.5, STONE_D)                  # Harcourt St (DSER)

    # tram standards + overhead running wire (DUTC electrified 1901)
    TRAM_STREETS = {"sackville": (-4.5, 4.5), "north quay": (0.0,),
                    "westmoreland_grafton": (0.0,)}
    for (pts, spacing, name, width) in PRINCIPALS:
        if name not in TRAM_STREETS:
            continue
        lines = TRAM_STREETS[name]
        for a, c in zip(pts[:-1], pts[1:]):
            ex, ez = c[0] - a[0], c[1] - a[1]
            L = float(np.hypot(ex, ez))
            ux, uz = ex / L, ez / L
            nx, nz = -uz, ux
            ang = float(np.arctan2(-ez, ex))
            mx, mz = (a[0] + c[0]) / 2, (a[1] + c[1]) / 2
            base = terrain_height(mx, mz)
            for off in lines:                            # the running wires
                b.block((mx + nx * off, base + 6.1, mz + nz * off),
                        (L, 0.06, 0.06), IRON, rot_z=ang)
            s = 16.0
            while s < L - 10:                            # standards: centre poles on Sackville
                px_, pz_ = a[0] + ux * s, a[1] + uz * s
                pb = terrain_height(px_, pz_)
                if len(lines) > 1:
                    b.capsule((px_, pb, pz_), (px_, pb + 6.6, pz_), 0.11, 0.08, IRON)
                    b.block((px_, pb + 6.15, pz_), (0.1, 0.08, 10.0), IRON, rot_z=ang)
                else:
                    for side in (1, -1):
                        qx = px_ + nx * side * (width / 2 - 0.6)
                        qz = pz_ + nz * side * (width / 2 - 0.6)
                        qb = terrain_height(qx, qz)
                        b.capsule((qx, qb, qz), (qx, qb + 6.5, qz), 0.1, 0.07, IRON)
                    b.block((px_, pb + 6.35, pz_), (0.07, 0.06, width - 1.0), IRON, rot_z=ang)
                s += 42.0

    def tram(x, z, ux, uz, livery):
        ang = float(np.arctan2(-uz, ux))
        nx, nz = -uz, ux
        base = terrain_height(x, z)
        OCC.mark(x, z, 5.6, 2.3, ang)
        b.block((x, base + 1.05, z), (5.4, 1.7, 2.15), livery, rot_z=ang)     # lower saloon
        b.block((x, base + 2.2, z), (5.4, 0.6, 2.15), CREAM, rot_z=ang)       # window band
        b.block((x, base + 2.62, z), (5.5, 0.16, 2.2), (58, 56, 54), rot_z=ang)   # deck
        for side in (1, -1):                                                  # open-top rails
            b.block((x + nx * side * 1.02, base + 3.0, z + nz * side * 1.02),
                    (5.3, 0.06, 0.05), IRON, rot_z=ang)
        for k in (-1.6, 0.0, 1.4):                                            # riders aloft
            if rng.random() < 0.7:
                px_ = x + ux * k + nx * float(rng.uniform(-0.6, 0.6))
                pz_ = z + uz * k + nz * float(rng.uniform(-0.6, 0.6))
                b.capsule((px_, base + 2.7, pz_), (px_, base + 3.35, pz_), 0.21, 0.16, (40, 38, 42))
        b.capsule((x - ux * 0.8, base + 2.72, z - uz * 0.8),                  # trolley pole
                  (x - ux * 2.1, base + 6.05, z - uz * 2.1), 0.05, 0.03, IRON)

    MAROON, GREEN, BLUE = (94, 34, 40), (44, 64, 46), (40, 52, 78)
    tram(12.5, -212, 0.0, -1.0, MAROON)      # at the Pillar terminus, heading out
    tram(3.5, -148, 0.0, 1.0, GREEN)         # inbound line
    tram(-210, -52, 1.0, 0.0, BLUE)          # along the north quay
    tram(46, 126, 0.157, 0.988, MAROON)      # Westmoreland Street

    def jaunting(x, z):
        base = terrain_height(x, z)
        OCC.mark(x, z, 4.6, 1.6, 0.0)
        b.block((x, base + 0.95, z), (1.6, 0.18, 0.95), (74, 58, 44))         # side-seat body
        b.block((x, base + 1.25, z), (1.5, 0.4, 0.16), (60, 46, 36))          # back-to-back rest
        for side in (-0.55, 0.55):                                            # the big wheels
            b.block((x, base + 0.55, z + side), (1.05, 1.05, 0.07), (34, 30, 28))
        coat = [(60, 44, 34), (30, 28, 30), (88, 56, 38)][int(rng.integers(0, 3))]
        hx = x - 2.0                                                          # the horse, in shafts
        b.capsule((hx - 0.75, base + 1.12, z), (hx + 0.75, base + 1.18, z), 0.3, 0.27, coat)
        b.capsule((hx + 0.7, base + 1.3, z), (hx + 1.15, base + 1.85, z), 0.15, 0.11, coat)
        b.capsule((hx + 1.15, base + 1.85, z), (hx + 1.55, base + 1.78, z), 0.11, 0.08, coat)
        for lx in (-0.55, 0.55):
            for lz in (-0.16, 0.16):
                b.capsule((hx + lx, base + 0.9, z + lz), (hx + lx + 0.06, base, z + lz),
                          0.05, 0.04, coat)
        for sz_ in (-0.42, 0.42):                                             # shafts
            b.capsule((x - 0.8, base + 0.9, z + sz_), (hx + 0.5, base + 1.0, z + sz_),
                      0.04, 0.03, (70, 56, 42))

    for k in range(4):                                    # the rank on Sackville's east side
        jaunting(19.5, -168 - k * 8.6)

    _net(b, g, i0, NET_B)
    b.anchor("base", (455, 1.9))
    b.anchor("pillar_terminus", (10.0, 2.0, -205.0))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.92, aged=True)


def industry(seed=83):
    """The working city: Guinness's brewery at James's Gate (stacks + stores), the docklands
    gasometer, coal-quay chimneys. 1904 Dublin's skyline smoked from these."""
    b, g = _landmark("industry")
    rng = np.random.default_rng(seed)
    i0 = Builder._next_index[0]
    BREW = (54, 44, 38)
    STACK = (72, 50, 40)

    # Guinness at James's Gate — west of the Liberties, hard by the river
    gx, gz = -760, 330
    for (ox, oz, w, h_, d) in ((0, 0, 46, 11, 26), (34, 10, 30, 8.5, 22), (-30, 14, 24, 13, 18)):
        base = terrain_height(gx + ox, gz + oz)
        OCC.mark(gx + ox, gz + oz, w, d, 0.0)
        b.block((gx + ox, base + h_ / 2, gz + oz), (w, h_, d), BREW,
                facade=(max(3, int(w / 4.0)), max(2, int(h_ / 3.6))))
    for sx in (gx - 12, gx + 22):                       # the great brewery chimneys
        base = terrain_height(sx, gz - 8)
        b.capsule((sx, base, gz - 8), (sx, base + 24.0, gz - 8), 1.6, 1.1, STACK)
        b.block((sx, base + 24.3, gz - 8), (2.6, 0.7, 2.6), (110, 96, 84))

    # the gasometer + coal-quay stacks, docklands south
    mx, mz = 880, 150
    base = terrain_height(mx, mz)
    OCC.mark(mx, mz, 30, 30, 0.0)
    b.block((mx, base + 5.0, mz), (26, 10, 19), (52, 56, 58))
    b.block((mx, base + 5.0, mz), (19, 10, 26), (52, 56, 58))
    b.block((mx, base + 10.3, mz), (20, 0.6, 20), (40, 44, 46))
    for (sx, sz) in ((905, 60), (958, 118)):
        base = terrain_height(sx, sz)
        b.capsule((sx, base, sz), (sx, base + 18.0, sz), 1.2, 0.85, STACK)

    _net(b, g, i0, NET_B)
    b.anchor("base", (gx, 1.9))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.9, aged=True)


def smoke(seed=89):
    """Coal smoke over the working city — plumes off the stacks drifting NE on the prevailing
    south-westerly. Ephemeral scene dressing for aerial/mood shots; street probes omit it."""
    b, g = _landmark("smoke")
    rng = np.random.default_rng(seed)
    i0 = Builder._next_index[0]
    PLUME = (182, 180, 174)
    # wind: SW → NE = (+x, −z), rising then flattening
    sources = [(-772, 322, 24.0, 2.2), (-738, 322, 24.0, 2.2),          # Guinness
               (905, 60, 18.0, 1.6), (958, 118, 18.0, 1.6)]             # coal quays
    for _ in range(14):                                                  # tenement belt
        sources.append((float(rng.uniform(150, 360)), float(rng.uniform(-310, -165)), 11.5, 0.9))
    for _ in range(8):                                                   # the Liberties
        sources.append((float(rng.uniform(-700, -460)), float(rng.uniform(380, 520)), 6.5, 0.7))
    for _ in range(10):                                                  # everywhere else, thinner
        sources.append((float(rng.uniform(-500, 500)), float(rng.uniform(-400, 400)), 9.0, 0.55))
    for (x, z, h0, r0) in sources:
        base = terrain_height(x, z)
        y0 = base + h0
        dx = float(rng.uniform(9, 16))
        dy = float(rng.uniform(5, 9))
        b.capsule((x, y0, z), (x + dx * 0.45, y0 + dy * 0.8, z - dx * 0.35), r0, r0 * 2.2, PLUME)
        b.capsule((x + dx * 0.45, y0 + dy * 0.8, z - dx * 0.35),
                  (x + dx * 1.35, y0 + dy * 1.15, z - dx * 1.0), r0 * 2.1, r0 * 3.1, PLUME)
    _net(b, g, i0, NET_B)
    b.anchor("base", (0, 1.9))
    return b.finish(skeleton=None, grains=g, droop=0.0, coherence=0.55, aged=False)


LANDMARKS["infill"] = block_infill
LANDMARKS["tenements"] = tenements
LANDMARKS["transport"] = transport
LANDMARKS["industry"] = industry
LANDMARKS["smoke"] = smoke
