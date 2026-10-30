CREATE TYPE "public"."trade_status" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'FAILED');--> statement-breakpoint
CREATE TABLE "trade_items" (
	"trade_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"from_team_id" integer NOT NULL,
	CONSTRAINT "trade_items_trade_id_player_id_pk" PRIMARY KEY("trade_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"proposer_team_id" integer NOT NULL,
	"receiver_team_id" integer NOT NULL,
	"status" "trade_status" DEFAULT 'PENDING' NOT NULL,
	"message" text,
	"fail_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "waiver_claims" ALTER COLUMN "drop_player_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_from_team_id_fantasy_teams_id_fk" FOREIGN KEY ("from_team_id") REFERENCES "public"."fantasy_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_proposer_team_id_fantasy_teams_id_fk" FOREIGN KEY ("proposer_team_id") REFERENCES "public"."fantasy_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_receiver_team_id_fantasy_teams_id_fk" FOREIGN KEY ("receiver_team_id") REFERENCES "public"."fantasy_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trades_league_idx" ON "trades" USING btree ("league_id","status");