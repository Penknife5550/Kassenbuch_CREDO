#!/bin/sh
set -e

echo "=== Kassenbuch Backend Start ==="

# 1. Prisma-Migrationen anwenden (idempotent – sicher bei jedem Start)
echo "Applying database migrations..."
npx prisma migrate deploy

# 2. Seed - laeuft dank First-Run-Guard (prisma/seed.ts, Marker-Tabelle
#    "seed_state") nur bei einer frisch aufgesetzten Datenbank. Bestehende
#    Installationen ueberspringt er, damit von Anwendern geloeschte oder
#    umbenannte Stammdaten nach einem Redeploy nicht zurueckkehren.
#      SKIP_SEED=1   -> Seed komplett ueberspringen
#      FORCE_SEED=1  -> Guard ignorieren und fehlende Standard-Stammdaten
#                       ergaenzen. ACHTUNG: "fehlend" heisst auch "vom Anwender
#                       bewusst geloescht" — geloeschte Standard-Konten und
#                       -Kostenstellen kehren dadurch zurueck, und zwar aktiv.
#                       Deaktivierte Stammdaten (isActive=false) bleiben
#                       unangetastet, weil der Seed nur anlegt und nie updatet.
#                       Nur fuer frische oder halb aufgesetzte Installationen.
if [ "${SKIP_SEED}" = "1" ]; then
  echo "SKIP_SEED=1 – Seeding übersprungen."
else
  echo "Running database seed (First-Run-Guard aktiv)..."
  npx prisma db seed
fi

# 3. Node.js-Server starten
echo "Starting server..."
exec node dist/index.js
