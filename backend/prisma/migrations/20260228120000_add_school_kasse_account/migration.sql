-- AlterTable
ALTER TABLE "schools" ADD COLUMN "kasse_account_id" TEXT;

-- AddForeignKey
ALTER TABLE "schools" ADD CONSTRAINT "schools_kasse_account_id_fkey" FOREIGN KEY ("kasse_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
