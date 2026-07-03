"""The Fox and the Crow — declaratively staged.

No magic-number coordinates for relations: the crow PERCHES ON the tree's branch-end anchor,
the fox LOOKS AT the crow (head pitch solved from the relation), and the painter's attention
vortices fall out of what the stage says matters. Sculptor → stager → painter.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2] / "core"))
sys.path.insert(0, str(Path(__file__).parent))
from stage import Stage
from creatures import fox, crow, bare_tree

st = Stage()
tree = st.place(bare_tree, at=(0.62, 0.0))
bird = st.place(crow, perch_on=tree.anchor("branch_end"))
reynard = st.place(fox, at=(-0.62, 0.0), look_at=bird.anchor("head"))

st.attend(bird.anchor("head"))                      # the story's second center, after the moon
st.stars((0.66, 0.07), (0.88, 0.16), (0.94, 0.40), (0.06, 0.46), (0.32, 0.05))

if __name__ == "__main__":
    out = Path(__file__).parent / "out"
    out.mkdir(exist_ok=True)
    aux = out / "f_staged_aux.npz"
    st.render(out_png=out / "f_staged.png", aux_path=aux)
    vort, stars = st.paint_directives()
    print(out / "f_staged.png")
    print(f'paint: python core/styles.py projects/fable/out/f_staged.png projects/fable/out/f_staged_aux.npz vangogh projects/fable/out/s_staged_vangogh.png 5 "{vort}" "{stars}"')
