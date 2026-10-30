CREATE TABLE "player_history" (
	"season_year" integer NOT NULL,
	"match_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"round_order" integer NOT NULL,
	"kickoff" timestamp with time zone NOT NULL,
	"club_name" text NOT NULL,
	"opponent_name" text NOT NULL,
	"home" boolean NOT NULL,
	"position" "position" NOT NULL,
	"stats" jsonb NOT NULL,
	CONSTRAINT "player_history_season_year_match_id_player_id_pk" PRIMARY KEY("season_year","match_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "fantasy_teams" ADD COLUMN "formation" text DEFAULT '4-4-2' NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "injury_return" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "injury_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "birth_date" text;--> statement-breakpoint
CREATE INDEX "history_player_idx" ON "player_history" USING btree ("player_id");