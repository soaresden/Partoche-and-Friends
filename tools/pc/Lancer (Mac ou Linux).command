#!/bin/sh
# Mac / Linux : lance Partoche and Friends sur http://localhost:53682 (Python 3 est déjà présent sur Mac et Linux)
cd "$(dirname "$0")" || exit 1
exec python3 serveur.py app Partitions
