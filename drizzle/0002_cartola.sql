ALTER TABLE "matchups" ALTER COLUMN "home_points" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "matchups" ALTER COLUMN "away_points" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "player_match_stats" ALTER COLUMN "points" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "shots_off_target" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "offsides" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "fouls_suffered" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "penalties_won" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "penalties_conceded" integer DEFAULT 0 NOT NULL;