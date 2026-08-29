CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text DEFAULT 'briefing' NOT NULL,
	"title" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"target_sec" integer NOT NULL,
	"actual_sec" integer,
	"story_ids" uuid[] DEFAULT '{}' NOT NULL,
	"outline" jsonb,
	"script" jsonb,
	"audio_url" text,
	"cost" jsonb,
	"prompt_versions" jsonb,
	"failed_stage" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "explained_concepts" (
	"user_id" uuid NOT NULL,
	"concept" text NOT NULL,
	"last_explained_at" timestamp with time zone NOT NULL,
	"episode_id" uuid,
	CONSTRAINT "explained_concepts_user_id_concept_pk" PRIMARY KEY("user_id","concept")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"url" text,
	"canonical_url" text,
	"source_hash" text NOT NULL,
	"title" text,
	"author" text,
	"publisher" text,
	"published_at" timestamp with time zone,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lang" text,
	"raw" jsonb,
	"clean_text" text,
	"analysis" jsonb,
	"embedding" vector(1024),
	"extraction_quality" real,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	CONSTRAINT "sources_user_id_source_hash_unique" UNIQUE("user_id","source_hash")
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"headline" text NOT NULL,
	"topic" text,
	"source_ids" uuid[] NOT NULL,
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding" vector(1024),
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"api_token" text NOT NULL,
	"rss_token" text NOT NULL,
	"output_language" text DEFAULT 'fr' NOT NULL,
	"voice_id" text,
	"target_minutes" integer DEFAULT 15 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_api_token_unique" UNIQUE("api_token"),
	CONSTRAINT "users_rss_token_unique" UNIQUE("rss_token")
);
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explained_concepts" ADD CONSTRAINT "explained_concepts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;