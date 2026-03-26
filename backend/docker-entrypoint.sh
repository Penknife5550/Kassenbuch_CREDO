#!/bin/sh
set -e

echo "=== Kassenbuch Backend Start ==="

# 1. Prisma-Migrationen anwenden (idempotent – sicher bei jedem Start)
echo "Applying database migrations..."
npx prisma migrate deploy

# 2. Seed (nutzt upsert – idempotent, überschreibt keine vorhandenen Daten)
#    Kann mit SKIP_SEED=1 übersprungen werden falls gewünscht
if [ "${SKIP_SEED}" = "1" ]; then
  echo "SKIP_SEED=1 – Seeding übersprungen."
else
  echo "Running database seed (idempotent)..."
  npx prisma db seed
fi

# 3. Node.js-Server starten
echo "Starting server..."
exec node dist/index.js
