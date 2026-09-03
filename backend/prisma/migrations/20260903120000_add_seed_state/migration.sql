-- Marker-Tabelle fuer den First-Run-Guard des Seeds.
-- Ohne Guard legte prisma/seed.ts bei JEDEM Container-Start die Standard-
-- Stammdaten per upsert neu an; von Anwendern geloeschte Konten tauchten
-- dadurch nach jedem Redeploy/Neustart wieder auf.
CREATE TABLE "seed_state" (
    "id" TEXT NOT NULL,
    "seeded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seed_state_pkey" PRIMARY KEY ("id")
);

-- Bestandsinstallationen sofort als initialisiert markieren, damit bereits der
-- erste Start nach diesem Deploy nichts mehr wiederherstellt. Als Nachweis dient
-- die DATEV-Konfiguration: sie ist der letzte Datensatz, den der Seed anlegt, und
-- belegt damit einen vollstaendig durchgelaufenen Seed (gleiche Regel wie
-- src/services/seedStateService.ts).
INSERT INTO "seed_state" ("id", "seeded_at")
SELECT 'default', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "datev_export_config");
