-- Add sleep period tracking to organic_activity_schedule table
ALTER TABLE "organic_activity_schedule"
ADD COLUMN "sleep_start_time" timestamp,
ADD COLUMN "sleep_end_time" timestamp,
ADD COLUMN "last_sleep_calculation" text;
