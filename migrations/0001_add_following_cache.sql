CREATE TABLE "following_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"following_username" text NOT NULL,
	"following_user_id" text,
	"following_name" text,
	"last_refreshed" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "following_cache_username_idx" ON "following_cache" ("username");
