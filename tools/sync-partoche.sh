#!/bin/sh
# Reprend les briques partagées depuis Partoche (dépôt MSCZPlayer à côté de celui-ci).
# Attention : web/js/partoche/ink.js contient un ajout (setLayers, plusieurs calques) à reporter après copie.
set -e
cd "$(dirname "$0")/.."
P=${1:-../MSCZPlayer/web}
cp "$P"/lib/* web/lib/
for f in score.js audio.js midi.js store.js pcloud.js; do cp "$P/js/$f" web/js/partoche/; done
sed -i "s#'../lib/fflate.js'#'../../lib/fflate.js'#" web/js/partoche/*.js
echo "OK. ink.js non copié automatiquement (il contient setLayers) : fusionner à la main si besoin."
