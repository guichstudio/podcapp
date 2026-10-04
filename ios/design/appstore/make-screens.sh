#!/bin/sh
# Builds the App Store screenshots (iPhone 6.9", 1320x2868) into out/<lang>/.
#
# Two sources:
#   cap/<lang>/<page>.png  onboarding pages, captured on the iPhone 17 Pro Max
#                          simulator (native 1320x2868, status bar at 9:41) and
#                          used full-bleed: they already are marketing pages.
#                          Only the grey build stamp ("b35") next to the
#                          wordmark is painted out.
#   app/<shot>.png         in-app screens (Read, Library, Settings), framed by
#                          frame.html with a caption. English UI only for now,
#                          so the French set carries the onboarding alone.
#
#   sh ios/design/appstore/make-screens.sh
#
# Output is RGB PNG without alpha: App Store Connect rejects transparency.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Google Chrome not found at $CHROME" >&2; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

for shot in read sources settings; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1320,2868 \
    --allow-file-access-from-files --virtual-time-budget=4000 \
    --screenshot="$TMP/en-$shot.png" \
    "file://$DIR/frame.html?lang=en&shot=$shot" >/dev/null 2>&1
  [ -s "$TMP/en-$shot.png" ] || { echo "render failed: $shot" >&2; exit 1; }
done

python3 - "$TMP" "$DIR" <<'PY'
import sys, os, shutil
from PIL import Image
tmp, d = sys.argv[1], sys.argv[2]
# Store order: the first three are the only ones seen in search results.
ORDER = {
    "en": ["cap/recap", "cap/built", "cap/share", "app/read", "cap/listen",
           "cap/anything", "app/sources", "app/settings"],
    "fr": ["cap/recap", "cap/built", "cap/share", "cap/listen", "cap/anything"],
}
shutil.rmtree(f"{d}/out", ignore_errors=True)
for lang, items in ORDER.items():
    os.makedirs(f"{d}/out/{lang}")
    for i, item in enumerate(items, 1):
        kind, name = item.split("/")
        if kind == "cap":
            im = Image.open(f"{d}/cap/{lang}/{name}.png").convert("RGB")
            # Paint out the build stamp with the background just right of it:
            # the gradient only moves vertically at this scale.
            patch = im.crop((860, 282, 928, 324))
            im.paste(patch, (790, 282))
        else:
            im = Image.open(f"{tmp}/en-{name}.png").convert("RGB")
        assert im.size == (1320, 2868), f"{lang}/{name}: {im.size}"
        dst = f"{d}/out/{lang}/{i:02d}-{name}.png"
        im.save(dst, optimize=True)
        print(f"  out/{lang}/{i:02d}-{name}.png  {os.path.getsize(dst) // 1024} KB")
PY
