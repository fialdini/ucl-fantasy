ALTER TYPE "public"."trade_status" ADD VALUE 'REVIEW' BEFORE 'ACCEPTED';--> statement-breakpoint
ALTER TYPE "public"."trade_status" ADD VALUE 'VETOED';--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "draft_pick_seconds" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "trade_review_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "review_ends_at" timestamp with time zone;