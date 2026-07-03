"""Assemble the spike report HTML with embedded images (JPEG data URIs)."""

import base64
import io
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
PROJ = HERE.parent / "projects"


def data_uri(name, q=87):
    im = Image.open(PROJ / name).convert("RGB")
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


IMG = {k: data_uri(f) for k, f in {
    "fox1": "studies/out/a_fox_v1.png", "fox2": "studies/out/a_fox_v2.png",
    "head1": "studies/out/b_head_v1.png", "head2": "studies/out/b_head_v2.png", "head3": "studies/out/b_head_v3.png",
    "cameo1": "studies/out/c_cameo_v1.png", "cameo2": "studies/out/c_cameo_v2.png", "cameo3": "studies/out/c_cameo_v3.png",
    "paint": "studies/out/d_fox_painted.png",
    "scene1": "fable/out/e_scene_v1.png", "scene2": "fable/out/e_scene_v2.png",
    "svg": "studies/out/s_fox_vangogh.png", "smo": "studies/out/s_fox_monet.png", "spi": "studies/out/s_fox_picasso.png",
    "ssk": "studies/out/s_fox_sketch.png", "swa": "studies/out/s_fox_watercolor.png",
    "fin0": "fable/out/s_scene_vangogh.png", "fin1": "fable/out/s_scene_vangogh2.png", "fin3": "fable/out/s_scene_vangogh4.png", "fin4": "fable/out/s_staged_vangogh.png", "fin2": "fable/out/s_scene_sketch.png",
}.items()}


def fig(key, label, note=""):
    cap = f'<span class="plate-id">{label}</span>'
    if note:
        cap += f" {note}"
    return f'<figure><img src="{IMG[key]}" alt="{label}: {note}"/><figcaption>{cap}</figcaption></figure>'


HTML = """<title>The Sighted Hand — illustration spike</title>
<style>
  :root {
    --ground: #17120E; --panel: #221B14; --panel-2: #2B2118;
    --ink: #EDE4D4; --ink-2: #A2937E; --line: rgba(237,228,212,.14);
    --rust: #C4622A; --rust-hi: #E08B4F; --gold: #B69452;
    --serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
    --sans: system-ui, 'Segoe UI', sans-serif;
    --mono: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { background: var(--ground); color: var(--ink); font-family: var(--sans);
         line-height: 1.6; margin: 0; padding: 0 20px 90px; }
  .wrap { max-width: 960px; margin: 0 auto; }
  header { padding: 72px 0 36px; border-bottom: 1px solid var(--line); }
  .eyebrow { font-family: var(--mono); font-size: 12px; letter-spacing: .18em;
             text-transform: uppercase; color: var(--rust-hi); }
  h1 { font-family: var(--serif); font-weight: 500; font-size: clamp(34px, 6vw, 54px);
       margin: 10px 0 14px; letter-spacing: .01em; text-wrap: balance; }
  .thesis { max-width: 62ch; color: var(--ink-2); font-size: 17px; }
  .thesis strong { color: var(--ink); font-weight: 600; }
  .pipeline { display: flex; flex-wrap: wrap; gap: 10px; margin: 26px 0 0; padding: 0; list-style: none;
              font-family: var(--mono); font-size: 13px; }
  .pipeline li { border: 1px solid var(--line); border-radius: 3px; padding: 7px 14px; color: var(--ink); background: var(--panel); }
  .pipeline li em { color: var(--rust-hi); font-style: normal; }

  section { padding: 52px 0 8px; }
  .sec-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
  .plate-no { font-family: var(--mono); color: var(--gold); font-size: 13px; letter-spacing: .14em; }
  h2 { font-family: var(--serif); font-weight: 500; font-size: 29px; margin: 0; }
  .verdict { font-family: var(--mono); font-size: 11.5px; letter-spacing: .1em; text-transform: uppercase;
             padding: 4px 10px; border-radius: 2px; margin-left: auto; }
  .v-yes { background: rgba(196,98,42,.18); color: var(--rust-hi); border: 1px solid rgba(196,98,42,.5); }
  .v-ceiling { background: rgba(162,147,126,.12); color: var(--ink-2); border: 1px solid rgba(162,147,126,.4); }
  .v-star { background: rgba(182,148,82,.16); color: #D8BE85; border: 1px solid rgba(182,148,82,.55); }
  section > p { max-width: 68ch; color: var(--ink-2); }
  section > p strong { color: var(--ink); }

  .plates { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 18px; margin: 26px 0 10px; }
  figure { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 4px;
           padding: 10px 10px 8px; }
  figure img { width: 100%; height: auto; display: block; border-radius: 2px; }
  figcaption { font-family: var(--mono); font-size: 12px; color: var(--ink-2); padding: 9px 2px 2px; line-height: 1.5; }
  .plate-id { color: var(--gold); }

  .note { border-left: 2px solid var(--rust); background: var(--panel);
          padding: 14px 18px; margin: 22px 0; max-width: 68ch; font-size: 15px; color: var(--ink-2); }
  .note strong { color: var(--ink); }

  .next { border-top: 1px solid var(--line); margin-top: 56px; padding-top: 40px; }
  .next ul { max-width: 68ch; color: var(--ink-2); padding-left: 22px; }
  .next li { margin: 10px 0; }
  .next li strong { color: var(--ink); }
  footer { margin-top: 60px; font-family: var(--mono); font-size: 12px; color: var(--ink-2); }
</style>
<div class="wrap">
<header>
  <div class="eyebrow">Generative Arcana · R&amp;D spike · July 2026</div>
  <h1>The Sighted Hand</h1>
  <p class="thesis">Why does my art stay abstract? Because code-drawing is usually done <strong>blind</strong> —
  and abstraction is what survives blindness. But I can render an image and then <strong>look at it</strong>,
  critique it, and revise the code. This spike tests what representational illustration becomes possible
  when every technique is wrapped in that closed loop.</p>
  <ul class="pipeline">
    <li><em>MODEL</em> form as 3D clay / relief</li>
    <li><em>LIGHT</em> realism from shading, not outline</li>
    <li><em>LOOK</em> render → my eyes → critique</li>
    <li><em>PAINT</em> strokes replace the CG surface</li>
  </ul>
</header>

<section>
  <div class="sec-head"><span class="plate-no">PLATE I</span><h2>Digital clay — sculpt, then photograph</h2>
    <span class="verdict v-yes">validated · 2 iterations</span></div>
  <p>A sitting fox modeled as ~20 smooth-blended distance-field primitives — spheres, capsules,
  ellipsoids melting together like clay — then raymarched with a key/fill/rim rig and ambient
  occlusion. Nothing is drawn; anatomy is <strong>declared as volume</strong> and the light does the rest.
  v1 was recognizably a fox on the first blind attempt; one eyes-on pass fixed the bleached
  material blending, the vanished eyes, and the dead background.</p>
  <div class="plates">
    __FOX1__
    __FOX2__
  </div>
</section>

<section>
  <div class="sec-head"><span class="plate-no">PLATE II</span><h2>The frontal bust — an instructive ceiling</h2>
    <span class="verdict v-ceiling">ceiling found · 3 iterations</span></div>
  <p>The acid test: a human face from the same additive clay. Three proportion passes moved it from
  goblin toward mannequin — and revealed the hard limit: <strong>facial features are cuts, not bumps.</strong>
  Eye sockets, the mouth line, the nasolabial fold are subtractive; additive blobs can only pout.
  The fix is known (carve operators, a jaw armature, three-quarter pose) but it isn't three more
  iterations — it's a sculpting toolkit.</p>
  <div class="plates">
    __HEAD1__
    __HEAD2__
    __HEAD3__
  </div>
  <div class="note"><strong>Worth keeping anyway:</strong> at v3 the output reads as carved statuary rather
  than a failed human — usable wherever a deck wants idols, monuments, or weathered gods, where
  the uncanny reads as intentional.</div>
</section>

<section>
  <div class="sec-head"><span class="plate-no">PLATE III</span><h2>The cameo — a profile is one editable line</h2>
    <span class="verdict v-star">strongest result · 3 iterations</span></div>
  <p>The classical answer to the frontal problem. In profile, the entire likeness lives in
  <strong>one silhouette line</strong> — and a 2D outline is precisely the thing an eyes-on loop can judge
  point by point. The head is an authored polygon (every vertex a named landmark: brow notch,
  philtrum, lip parting), turned organic by Chaikin corner-cutting, raised into shallow relief by
  its own distance field, and lit as shell-on-sardonyx with cavity shading. v1 was folded paper;
  v2 found the profile; v3 folded the hair into the silhouette and set the whole thing in a bezel.</p>
  <div class="plates">
    __CAMEO1__
    __CAMEO2__
    __CAMEO3__
  </div>
  <div class="note"><strong>Why this one matters:</strong> the vertex list is legible, nameable, and editable in
  conversation — "stronger chin, straighter nose" is a two-number change. It is the most
  <em>steerable</em> representational technique found today, and sixteen court cards in any deck could
  each be a different carved profile.</div>
</section>

<section>
  <div class="sec-head"><span class="plate-no">PLATE IV</span><h2>The painterly pass — strokes over modeled truth</h2>
    <span class="verdict v-yes">validated · 1 iteration</span></div>
  <p>The renders are true but smooth — they confess CG. This pass repaints any render with a few
  thousand short brushstrokes that follow the image's own flow field (strokes run along form
  contours, long and lazy in flat areas, short and careful at edges), with jittered color and a
  grain overlay. <strong>The model supplies correct form and light; the strokes supply hand.</strong>
  Coordinate imprecision stops being error and becomes style.</p>
  <div class="plates">
    __FOX2B__
    __PAINT__
  </div>
</section>

<section>
  <div class="sec-head"><span class="plate-no">PLATE V · RIFF 2</span><h2>Composition — two subjects, one gaze, an environment</h2>
    <span class="verdict v-yes">validated · 2 iterations</span></div>
  <p>Aesop's <strong>Fox and Crow</strong> — a fable, by Fable. Composition as relation: the fox's lifted
  muzzle and the crow's downward beak make a single diagonal, the card's spine. The tree holds the
  right third, the moon answers it upper-left, and a G-buffer-driven post pass (sky, far hills,
  low ground mist) embeds both subjects in one atmosphere. v2 planted the floating crow on an
  elbowed branch, separated the fox's ears — and added <strong>the cheese</strong>: the relation isn't just
  gaze, it's desire with an object.</p>
  <div class="plates">
    __SCENE1__
    __SCENE2__
  </div>
</section>

<section>
  <div class="sec-head"><span class="plate-no">PLATE VI · RIFF 2</span><h2>Style engines — strokes that know what they paint</h2>
    <span class="verdict v-star">3 of 5 land · 1 honest miss</span></div>
  <p>The answer to "the strokes feel like static": the model now emits a <strong>G-buffer</strong> (subject
  mask, depth, surface normals, material ids), so each engine treats sky, ground, and subject as
  different painting problems, and stroke orientation comes from <strong>3D form</strong> — strokes wrap the
  body instead of following pixel noise. Five engines, one fox:</p>
  <div class="plates">
    __SVG__
    __SMO__
    __SPI__
    __SSK__
    __SWA__
  </div>
  <div class="note"><strong>The Picasso miss is the interesting one:</strong> spatial fracture (Voronoi cells)
  dissolves the subject instead of restating it — cubism decomposes <em>objects</em> (an eye, a muzzle,
  a haunch seen from different angles), not pixels. But the SDF scene knows its parts. A future
  engine could render each anatomical part separately and collage them — cubism from the model.</div>
</section>

<section>
  <div class="sec-head"><span class="plate-no">PLATE VII · RIFF 2</span><h2>The full pipeline, twice</h2>
    <span class="verdict v-star">the destination</span></div>
  <p>Model → light → compose → paint, end to end: the same sculpted scene wearing two different
  hands. The Van Gogh engine turns the night sky into current and the fox into flame; the
  naturalist engine turns the same geometry into a plate from an old edition of Aesop. <strong>One
  scene, any hand</strong> — this is what a fully code-native illustrated deck could look like.</p>
  <div class="plates">
    __FIN0__
    __FIN1__
    __FIN3__
    __FIN4__
    __FIN2__
  </div>
  <div class="note"><strong>Riff 3 — subtle structure without moving the layout:</strong> fur combed by an
  authored flow skeleton (nose→tail, draping off the spine); fog rebuilt as height-enveloped
  anisotropic noise painted as density-weighted strokes (wisps and gaps, not ovals or veils);
  stars made emergent — short bright strokes riding the same field plus a tiny local vortex,
  after explicit halo-ring stars read as rivets; bark grain along the trunk. And the subjects
  are now a posable sculpture library (creatures.py) — origin, mirror, head-pitch — so a whole
  deck can compose scenes from carved primitives and illustrate them in a separate pass.
  The distilled method for other models lives in PRINCIPLES.md.</div>
  <div class="note"><strong>The close-reading revision:</strong> the first painted version had an accidental
  vortex over the tree bending strokes across object bodies, a kinked "V" where two swirl fields
  met (angles were summed instead of direction vectors — the seam was real physics, badly
  integrated), and a homogenizing grey mist veil. The revision makes the field narrative: one
  vortex ON the moon, one ON the crow, strokes stopping at silhouettes, and mist repainted as
  directional fog strokes. The field now encodes the story's two centers of attention.</div>
</section>

<section class="next">
  <div class="sec-head"><h2>Where this goes</h2></div>
  <ul>
    <li><strong>Cameo court cards.</strong> The Deep Time Prospector/Surveyor/Reader/Witness as four carved
        profiles — same relief pipeline, per-suit stone (basalt, sandstone, marble, slate).</li>
    <li><strong>Painted majors.</strong> Sculpt each major's scene in clay-SDF, light it in its station's key,
        then stroke-pass it — a fully "hand-painted" 22-trump set from pure code.</li>
    <li><strong>The missing chisel.</strong> Add subtractive/carve operators and a pose rig to the SDF kit;
        that's what stands between the mannequin and a face.</li>
    <li><strong>Stroke pass as a skin filter.</strong> It runs on any image — including existing p5 skins —
        so "Core Sample · Painted" is one build script away.</li>
    <li><strong>Cubism from the model.</strong> The SDF scene knows its anatomical parts — render them
        separately from shifted viewpoints and collage: semantic fracture, not spatial.</li>
    <li><strong>A fable bestiary.</strong> The clay kit + composition grammar (gaze lines, object of desire,
        environment post) generalizes to any two-subject scene — Aesop as a 22-card major set.</li>
  </ul>
  <footer>tools/illustration-spike/ — sdflib.py · a_fox.py · b_head.py · c_cameo.py · d_painterly.py — every image reproducible from source · Fable</footer>
</section>
</div>
"""

html = (HTML
        .replace("__FOX1__", fig("fox1", "v1 · first blind sculpt", "readable, but bleached materials, no eyes"))
        .replace("__FOX2__", fig("fox2", "v2 · after one look", "eyes, stockings, inner ears, dusk key"))
        .replace("__HEAD1__", fig("head1", "v1", "the goblin zone"))
        .replace("__HEAD2__", fig("head2", "v2", "proportions corrected, still uncanny"))
        .replace("__HEAD3__", fig("head3", "v3", "fuller jaw — and the mouth vanished: features are cuts"))
        .replace("__CAMEO1__", fig("cameo1", "v1", "the profile reads; the surface is folded paper"))
        .replace("__CAMEO2__", fig("cameo2", "v2", "Chaikin smoothing — organic; hair layer failing"))
        .replace("__CAMEO3__", fig("cameo3", "v3", "one silhouette, stronger relief, bezel"))
        .replace("__FOX2B__", fig("fox2", "input", "the v2 render — true, but smooth"))
        .replace("__PAINT__", fig("paint", "output", "5,200 flow-field strokes + grain"))
        .replace("__SCENE1__", fig("scene1", "v1", "the gaze diagonal works; the crow floats, dove-gray"))
        .replace("__SCENE2__", fig("scene2", "v2", "planted, black, and holding the cheese"))
        .replace("__SVG__", fig("svg", "van gogh", "form-wrapped impasto; vortex sky — the winner"))
        .replace("__SMO__", fig("smo", "monet", "broken color, lost edges, lavender light"))
        .replace("__SPI__", fig("spi", "picasso", "the honest miss — pixels fracture, objects don't"))
        .replace("__SSK__", fig("ssk", "naturalist", "contour + tonal hatching on cream"))
        .replace("__SWA__", fig("swa", "watercolor", "displaced washes, pooled edges, sienna pigment"))
        .replace("__FIN0__", fig("fin0", "painted, first pass", "accidental attractor; kinked seam; mist as veil"))
        .replace("__FIN1__", fig("fin1", "painted, revised", "vortices on moon + crow; strokes respect bodies; fog as strokes"))
        .replace("__FIN2__", fig("fin2", "the fable, etched", "naturalist engine on the same geometry"))
        .replace("__FIN3__", fig("fin3", "painted, third pass", "combed fur, wisp fog, emergent stars, tree grain — scene now built from the posable creature library"))
        .replace("__FIN4__", fig("fin4", "painted, staged", "sculptor-stager-painter: crow perches on an anchor, fox's gaze solved from the relation, bark grain per limb, coherence + age channels")))

dst = HERE / "report.html"
dst.write_text(html, encoding="utf-8")
print(dst, len(html) // 1024, "KB")
