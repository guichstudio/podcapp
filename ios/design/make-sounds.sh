#!/bin/bash
# Regenerates the app's UI sounds into ios/Podcapp/Resources/Sounds/.
#
# They are bell shapes, not beeps: a fundamental plus one quiet second harmonic
# that dies faster, under an exponential decay. Short (under half a second),
# quiet (peaks near -12 dBFS), and tuned to one chord — D major — so two of them
# landing close together still agree.
#
# ffmpeg comes from the repo's ffmpeg-static dependency: no system install.
set -euo pipefail
cd "$(dirname "$0")/.."
FF=../node_modules/ffmpeg-static/ffmpeg
OUT=Podcapp/Resources/Sounds
mkdir -p "$OUT"

# note <freq> <decay> <gain> <delay ms> <index> -> two filter chains, two labels
note() {
  local f=$1 d=$2 g=$3 ms=$4 i=$5
  # awk, not bc: bc prints ".0315" with no leading zero and ffmpeg refuses it.
  local harmonic; harmonic=$(awk -v x="$f" 'BEGIN{printf "%.2f", x * 2}')
  local hgain; hgain=$(awk -v x="$g" 'BEGIN{printf "%.4f", x * 0.22}')
  local hdecay; hdecay=$(awk -v x="$d" 'BEGIN{printf "%.4f", x * 0.45}')
  INPUTS+=(-f lavfi -i "sine=f=$f:d=$d" -f lavfi -i "sine=f=$harmonic:d=$d")
  CHAINS+=("[$((i*2))]volume=$g,afade=t=out:st=0:d=$d:curve=exp,adelay=$ms[n$i]")
  CHAINS+=("[$((i*2+1))]volume=$hgain,afade=t=out:st=0:d=$hdecay:curve=exp,adelay=$ms[h$i]")
  LABELS+="[n$i][h$i]"
  COUNT=$((COUNT + 2))
}

build() {
  local name=$1
  local chains
  chains=$(IFS=';'; echo "${CHAINS[*]}")
  "$FF" -y -loglevel error "${INPUTS[@]}" \
    -filter_complex "$chains;${LABELS}amix=inputs=$COUNT:normalize=0,alimiter=limit=0.7,volume=0.9" \
    -ar 44100 -ac 1 -c:a aac -b:a 96k "$OUT/$name.m4a"
  echo "$OUT/$name.m4a"
}

reset() { INPUTS=(); CHAINS=(); LABELS=""; COUNT=0; }

# A chapter turning under the narration: the quietest thing here, and the only
# one that can fire while you are listening.
reset; note 2093.00 0.07 0.50 0 0; build tick

# Saved, connected, done: D5 up to A5, an open fifth.
reset; note 587.33 0.38 0.92 0 0; note 880.00 0.42 0.86 95 1; build up

# Refused: the same fifth walked backwards and darker.
reset; note 493.88 0.30 0.76 0 0; note 349.23 0.45 0.76 110 1; build down

# Generation queued: D major arpeggio, quick, on its way somewhere.
reset; note 587.33 0.26 0.72 0 0; note 739.99 0.26 0.72 70 1; note 880.00 0.40 0.78 140 2; build launch
