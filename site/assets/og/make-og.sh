#!/bin/sh
# Renders the 1200x630 Open Graph card, one per language, from card.html.
#
# The card is screenshotted rather than drawn by hand so it keeps using
# site.css: same Inter Tight, same tokens, same violet. Change the copy in
# card.html (the FR strings live in the script at the bottom) and re-run.
#
#   sh site/assets/og/make-og.sh
#
# Output is JPEG, not PNG: the same image is 60 KB instead of 310 KB with no
# visible difference on this gradient, and some link previewers skip an image
# over a few hundred KB.
#
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Google Chrome not found at $CHROME" >&2; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

shoot() {  # shoot <name> <query>
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1200,630 \
    --virtual-time-budget=4000 --screenshot="$TMP/$1.png" \
    "file://$DIR/card.html$2" >/dev/null 2>&1
  [ -s "$TMP/$1.png" ] || { echo "render failed: $1" >&2; exit 1; }
}

echo "rendering:"
shoot en ""
shoot fr "?lang=fr"

python3 - "$TMP" "$DIR" <<'PY'
import sys, os
from PIL import Image
tmp, out = sys.argv[1], sys.argv[2]
for lang in ("en", "fr"):
    im = Image.open(f"{tmp}/{lang}.png").convert("RGB")
    assert im.size == (1200, 630), f"{lang}: {im.size}, expected 1200x630"
    dst = f"{out}/card-{lang}.jpg"
    im.save(dst, quality=92, optimize=True, progressive=True)
    print(f"  card-{lang}.jpg  {im.size[0]}x{im.size[1]}  {os.path.getsize(dst) // 1024} KB")
PY
