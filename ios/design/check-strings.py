#!/usr/bin/env python3
"""Finds translations in design/fr-strings.json that nothing uses any more.

English is the source language and every localised literal doubles as its own
key, so the table and the code have to agree. Neither a grep nor
make-strings.py can tell an orphaned key from an interpolated one: SwiftUI turns
Text("\\(n) links") into the key "%lld links", which never appears literally in
the source. This normalises both sides -- every interpolation and every format
specifier becomes one placeholder -- and then compares.

Only that direction. The reverse -- a localised literal with no translation --
cannot be answered without parsing Swift: a key reaches a localising call
through ternaries, TextField placeholders and helpers, while date formats,
header values and the French text baked into the onboarding mockups are string
literals that must NOT be translated. A first version reported seventy of those
as untranslated, which is worse than reporting nothing.

Errs toward keeping a key: every literal in the file counts as a use, comments
included, so a key named only in a comment survives. That is the safe way round.
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TABLE = json.loads((ROOT / "design/fr-strings.json").read_text())

LITERAL = re.compile(r'"((?:[^"\\\n]|\\.)*)"')
INTERP = re.compile(r'\\\((?:[^()]|\([^()]*\))*\)')
SPECIFIER = re.compile(r'%(?:\d+\$)?[@aAdefgGlqsuxX]+')

def shape(s: str) -> str:
    """Both sides reduced to the same thing: text plus placeholders."""
    return SPECIFIER.sub("␣", INTERP.sub("␣", s))

sources = sorted(
    list((ROOT / "Podcapp").rglob("*.swift")) + list((ROOT / "ShareExtension").rglob("*.swift"))
)
used = set()
for f in sources:
    for raw in LITERAL.findall(f.read_text()):
        used.add(shape(raw.replace('\\"', '"').replace("\\\\", "\\")))

# onboarding.* are the four keys that differ between the two tables by design;
# they are read through String(localized:) built at runtime, never as literals.
orphans = sorted(k for k in TABLE if shape(k) not in used and not k.startswith("onboarding."))
for o in orphans:
    print(f"ORPHAN  {o!r}")
print(f"\n{len(TABLE)} translations, {len(orphans)} used by nothing")
sys.exit(1 if orphans else 0)
