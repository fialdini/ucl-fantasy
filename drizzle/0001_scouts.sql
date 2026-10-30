ALTER TABLE "player_match_stats" ADD COLUMN "shots_on_target" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "shots_woodwork" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "tackles" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "interceptions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "dribbles" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "passes_completed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "passes_missed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "fouls_committed" integer DEFAULT 0 NOT NULL;