"""Assemble the Deep Time Tarot deck.json from its src/ fragments.

Computes each card's station_slug via the structural walks defined in
skill/generative-arcana/references/schema.md:
  minor: station = (rank.index + suit_stride * suit.index) mod N
  major: station = major_number mod N
and validates the deck's invariants before emitting.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "decks" / "deep-time" / "src"
OUT = ROOT / "decks" / "deep-time" / "deck.json"


def load(name: str):
    with open(SRC / name, encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    axes = load("axes.json")
    majors = load("majors.json")
    minors = {**load("minors-vents-strata.json"), **load("minors-grains-faults.json")}

    suits = axes["suits"]
    ranks = axes["ranks"]
    transversal = axes["transversal"]
    stations = transversal["stations"]
    stride = transversal.get("suit_stride", 1)
    n = len(stations)
    by_index = {s["index"]: s["slug"] for s in stations.values()}
    assert sorted(by_index) == list(range(n)), "station indices must be 0..N-1"

    from math import gcd
    assert gcd(stride, n) == 1, f"suit_stride {stride} not coprime to N={n}"

    errors = []

    # Majors: station from the major walk; factorization required.
    cards = {}
    for i in range(22):
        slug = f"major-{i}"
        card = majors.get(slug)
        if card is None:
            errors.append(f"missing {slug}")
            continue
        card["station_slug"] = by_index[i % n]
        f = card.get("factorization", {})
        if not f.get("gloss"):
            errors.append(f"{slug} missing factorization.gloss")
        if f.get("character") == "composite":
            prod = 1
            for p in f.get("factors", []):
                prod *= p
            if prod != i:
                errors.append(f"{slug} factors {f.get('factors')} do not multiply to {i}")
        cards[slug] = card

    # Minors: canonical order by suit index then rank index; station from the minor walk.
    suit_order = sorted(suits.values(), key=lambda s: s["index"])
    rank_order = sorted(ranks.values(), key=lambda r: r["index"])
    for suit in suit_order:
        for rank in rank_order:
            rank_slug = next(k for k, v in ranks.items() if v is rank)
            slug = f"{suit['slug']}-{rank_slug}"
            card = minors.get(slug)
            if card is None:
                errors.append(f"missing {slug}")
                continue
            if card["suit_slug"] != suit["slug"] or card["rank_slug"] != rank_slug:
                errors.append(f"{slug} suit/rank slugs inconsistent")
            if card["number"] != str(rank["numeric_value"]):
                errors.append(f"{slug} number {card['number']} != rank numeric_value {rank['numeric_value']}")
            card["station_slug"] = by_index[(rank["index"] + stride * suit["index"]) % n]
            cards[slug] = card

    if len(cards) != 78:
        errors.append(f"expected 78 cards, got {len(cards)}")

    # Station family sanity: each station's family should be non-trivial and cross-cutting.
    fam = {}
    for c in cards.values():
        fam.setdefault(c["station_slug"], []).append(c["slug"])
    for s_slug, members in sorted(fam.items(), key=lambda kv: kv[0]):
        minor_suits = {m.split("-")[0] for m in members if not m.startswith("major-")}
        if len(minor_suits) < 4:
            errors.append(f"station {s_slug} does not cross-cut all four suits: {sorted(minor_suits)}")

    if errors:
        print("VALIDATION FAILED:")
        for e in errors:
            print(" -", e)
        return 1

    deck = {
        "name": axes["name"],
        "slug": axes["slug"],
        "version": axes["version"],
        "theme": axes["theme"],
        "suits": {s["slug"]: s for s in suit_order},
        "ranks": {k: ranks[k] for k in sorted(ranks, key=lambda k: ranks[k]["index"])},
        "transversal": transversal,
        "major_arcana": axes["major_arcana"],
        "dialectic": axes["dialectic"],
        "cards": cards,
    }

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(deck, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"OK: wrote {OUT.relative_to(ROOT)}")
    print(f"  cards: {len(cards)} (22 major, {len(cards) - 22} minor)")
    for s_slug in [by_index[i] for i in range(n)]:
        members = fam[s_slug]
        print(f"  station {s_slug}: {len(members)} cards")
    return 0


if __name__ == "__main__":
    sys.exit(main())
