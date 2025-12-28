CREATE TABLE "recommended_cashtags" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"market_cap" integer NOT NULL,
	"volume_24h" integer NOT NULL,
	"price_change_24h" integer NOT NULL,
	"icon" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recommended_cashtags_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "tweet_searches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cashtag" text NOT NULL,
	"min_followers" integer DEFAULT 500 NOT NULL,
	"max_followers" integer DEFAULT 10000 NOT NULL,
	"time_range" text DEFAULT '1h' NOT NULL,
	"max_results" integer DEFAULT 100 NOT NULL,
	"exclude_retweets" boolean DEFAULT true NOT NULL,
	"verified_only" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tweets" (
	"id" varchar PRIMARY KEY NOT NULL,
	"search_id" varchar NOT NULL,
	"tweet_id" text NOT NULL,
	"content" text NOT NULL,
	"author_id" text NOT NULL,
	"author_name" text NOT NULL,
	"author_handle" text NOT NULL,
	"author_followers" integer NOT NULL,
	"author_avatar" text,
	"likes" integer DEFAULT 0 NOT NULL,
	"retweets" integer DEFAULT 0 NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"bot_analysis" jsonb,
	"source_hashtag" text NOT NULL,
	"is_reply" boolean DEFAULT false NOT NULL,
	"in_reply_to_tweet_id" text,
	"in_reply_to_user_id" text,
	"in_reply_to_username" text,
	"parent_tweet_url" text,
	"parent_tweet_content" text,
	"parent_tweet_author" text,
	"parent_tweet_followers" integer,
	"parent_tweet_replies" integer,
	"parent_tweet_age_minutes" integer,
	"meets_reply_criteria" boolean DEFAULT false NOT NULL,
	"is_parent_tweet" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tweets_tweet_id_unique" UNIQUE("tweet_id")
);
--> statement-breakpoint
ALTER TABLE "tweets" ADD CONSTRAINT "tweets_search_id_tweet_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."tweet_searches"("id") ON DELETE no action ON UPDATE no action;