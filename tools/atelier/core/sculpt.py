"""Sculptor-contract helpers shared by all sculpture libraries (see CONTROL_PLANE.md §1)."""

import numpy as np


class _P:
    """Transforms a local (x, y, z) into scene space: origin shift + optional mirror + pitch of
    points about a pivot (for posable heads)."""

    def __init__(self, ox, oy, mirror=False):
        self.ox, self.oy, self.m = ox, oy, mirror

    def __call__(self, x, y, z=0.0, pitch=0.0, pivot=None):
        if pitch and pivot is not None:
            px, py = pivot
            dx, dy = x - px, y - py
            c, s = np.cos(pitch), np.sin(pitch)
            x, y = px + dx * c - dy * s, py + dx * s + dy * c
        if self.m:
            x = -x
        return (x + self.ox, y + self.oy, z)
