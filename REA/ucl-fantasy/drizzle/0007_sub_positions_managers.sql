CREATE TABLE "coaches" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"club_id" integer NOT NULL,
	"photo_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_snapshots" (
	"team_id" integer NOT NULL,
	"round_order" integer NOT NULL,
	"coach_id" integer NOT NULL,
	CONSTRAINT "manager_snapshots_team_id_round_order_pk" PRIMARY KEY("team_id","round_order")
);
--> statement-breakpoint
ALTER TABLE "fantasy_teams" ADD COLUMN "manager_id" integer;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "started" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "sub_position" text DEFAULT 'AM' NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "injury_source" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "injury_note" text;--> statement-breakpoint
ALTER TABLE "coaches" ADD CONSTRAINT "coaches_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_snapshots" ADD CONSTRAINT "manager_snapshots_team_id_fantasy_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."fantasy_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_snapshots" ADD CONSTRAINT "manager_snapshots_coach_id_coaches_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coaches_club_idx" ON "coaches" USING btree ("club_id");--> statement-breakpoint
ALTER TABLE "fantasy_teams" ADD CONSTRAINT "fantasy_teams_manager_id_coaches_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."coaches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_league_manager_uq" ON "fantasy_teams" USING btree ("league_id","manager_id");--> statement-breakpoint
UPDATE "players" SET "sub_position" = CASE "position" WHEN 'GK' THEN 'GK' WHEN 'DEF' THEN 'CB' WHEN 'FWD' THEN 'ST' ELSE 'AM' END;
