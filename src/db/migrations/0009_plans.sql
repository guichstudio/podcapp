ALTER TABLE "users" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_original_txn_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_environment" text;
--> statement-breakpoint
-- Un abonnement ne peut appartenir qu'a un compte. L'index est PARTIEL parce
-- que la colonne est nulle pour tout compte gratuit, et que NULL ne collisionne
-- pas avec NULL en SQL mais l'index reste plus petit ainsi.
CREATE UNIQUE INDEX "users_one_account_per_subscription"
  ON "users" ("plan_original_txn_id")
  WHERE "plan_original_txn_id" IS NOT NULL;
