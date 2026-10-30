CREATE TYPE "public"."league_status" AS ENUM('SETUP', 'DRAFTING', 'ACTIVE', 'COMPLETE');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."matchup_kind" AS ENUM('REGULAR', 'SEMI', 'FINAL');--> statement-breakpoint
CREATE TYPE "public"."matchup_status" AS ENUM('SCHEDULED', 'PARTIAL', 'FINAL');--> statement-breakpoint
CREATE TYPE "public"."position" AS ENUM('GK', 'DEF', 'MID', 'FWD');--> statement-breakpoint
CREATE TYPE "public"."slot" AS ENUM('STARTER', 'BENCH');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('LEAGUE', 'PLAYOFF', 'R16', 'QF', 'SF', 'FINAL');--> statement-breakpoint
CREATE TYPE "public"."stats_status" AS ENUM('NONE', 'PARTIAL', 'FINAL');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('RUNNING', 'SUCCESS', 'PARTIAL', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."waiver_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "api_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"endpoint" text NOT NULL,
	"response" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"logo_url" text,
	"eliminated_after_round" integer
);
--> statement-breakpoint
CREATE TABLE "draft_picks" (
	"league_id" integer NOT NULL,
	"overall" integer NOT NULL,
	"round" integer NOT NULL,
	"team_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"auto" boolean NOT NULL,
	"picked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_picks_league_id_overall_pk" PRIMARY KEY("league_id","overall")
);
--> statement-breakpoint
CREATE TABLE "fantasy_teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_members" (
	"league_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_members_league_id_user_id_pk" PRIMARY KEY("league_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"invite_code" text NOT NULL,
	"commissioner_id" integer NOT NULL,
	"max_teams" integer NOT NULL,
	"status" "league_status" DEFAULT 'SETUP' NOT NULL,
	"start_round" integer NOT NULL,
	"draft_order" jsonb,
	"draft_current_pick" integer,
	"draft_pick_deadline" timestamp with time zone,
	"waiver_process_at" timestamp with time zone,
	"waiver_mode" text,
	"waiver_after_round" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leagues_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "lineup_snapshots" (
	"team_id" integer NOT NULL,
	"round_order" integer NOT NULL,
	"player_id" integer NOT NULL,
	"slot" "slot" NOT NULL,
	CONSTRAINT "lineup_snapshots_team_id_round_order_player_id_pk" PRIMARY KEY("team_id","round_order","player_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" integer PRIMARY KEY NOT NULL,
	"round_order" integer NOT NULL,
	"home_club_id" integer NOT NULL,
	"away_club_id" integer NOT NULL,
	"kickoff" timestamp with time zone NOT NULL,
	"status" "match_status" NOT NULL,
	"home_goals" integer,
	"away_goals" integer,
	"home_penalties" integer,
	"away_penalties" integer,
	"stats_status" "stats_status" DEFAULT 'NONE' NOT NULL,
	"stats_fetched_at" timestamp with time zone,
	"stats_error" text
);
--> statement-breakpoint
CREATE TABLE "matchups" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"kind" "matchup_kind" NOT NULL,
	"from_round" integer NOT NULL,
	"to_round" integer NOT NULL,
	"home_team_id" integer NOT NULL,
	"away_team_id" integer NOT NULL,
	"home_points" integer,
	"away_points" integer,
	"status" "matchup_status" DEFAULT 'SCHEDULED' NOT NULL,
	"winner_team_id" integer
);
--> statement-breakpoint
CREATE TABLE "player_match_stats" (
	"player_id" integer NOT NULL,
	"match_id" integer NOT NULL,
	"round_order" integer NOT NULL,
	"club_id" integer NOT NULL,
	"position" "position" NOT NULL,
	"minutes" integer NOT NULL,
	"goals" integer NOT NULL,
	"assists" integer NOT NULL,
	"own_goals" integer NOT NULL,
	"yellow_cards" integer NOT NULL,
	"red_cards" integer NOT NULL,
	"saves" integer NOT NULL,
	"goals_conceded" integer NOT NULL,
	"penalties_saved" integer NOT NULL,
	"penalties_missed" integer NOT NULL,
	"clean_sheet" boolean NOT NULL,
	"points" integer NOT NULL,
	"breakdown" jsonb NOT NULL,
	"final" boolean DEFAULT false NOT NULL,
	CONSTRAINT "player_match_stats_player_id_match_id_pk" PRIMARY KEY("player_id","match_id")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" "position" NOT NULL,
	"club_id" integer NOT NULL,
	"photo_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"injured" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"slot" "slot" NOT NULL,
	"acquired_via" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"order" integer PRIMARY KEY NOT NULL,
	"stage" "stage" NOT NULL,
	"leg" integer,
	"name" text NOT NULL,
	"first_kickoff" timestamp with time zone,
	"last_kickoff" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"provider" text NOT NULL,
	"status" "sync_status" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"requests" integer DEFAULT 0 NOT NULL,
	"message" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "waiver_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"add_player_id" integer NOT NULL,
	"drop_player_id" integer NOT NULL,
	"preference" integer NOT NULL,
	"status" "waiver_status" DEFAULT 'PENDING' NOT NULL,
	"fail_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_team_id_fantasy_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."fantasy_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fantasy_teams" ADD CONSTRAINT "fantasy_teams_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fantasy_teams" ADD CONSTRAINT "fantasy_teams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_commissioner_id_users_id_fk" FOREIGN KEY ("commissioner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineup_snapshots" ADD CONSTRAINT "lineup_snapshots_team_id_fantasy_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."fantasy_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineup_snapshots" ADD CONSTRAINT "lineup_snapshots_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_round_order_rounds_order_fk" FOREIGN KEY ("round_order") REFERENCES "public"."rounds"("order") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_club_id_clubs_id_fk" FOREIGN KEY ("home_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_club_id_clubs_id_fk" FOREIGN KEY ("away_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_home_team_id_fantasy_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."fantasy_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_away_team_id_fantasy_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."fantasy_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_slots" ADD CONSTRAINT "roster_slots_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_slots" ADD CONSTRAINT "roster_slots_team_id_fantasy_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."fantasy_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_slots" ADD CONSTRAINT "roster_slots_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_claims" ADD CONSTRAINT "waiver_claims_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_claims" ADD CONSTRAINT "waiver_claims_team_id_fantasy_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."fantasy_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_claims" ADD CONSTRAINT "waiver_claims_add_player_id_players_id_fk" FOREIGN KEY ("add_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_claims" ADD CONSTRAINT "waiver_claims_drop_player_id_players_id_fk" FOREIGN KEY ("drop_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_league_user_uq" ON "fantasy_teams" USING btree ("league_id","user_id");--> statement-breakpoint
CREATE INDEX "matches_round_idx" ON "matches" USING btree ("round_order");--> statement-breakpoint
CREATE INDEX "matchups_league_idx" ON "matchups" USING btree ("league_id","from_round");--> statement-breakpoint
CREATE INDEX "pms_round_idx" ON "player_match_stats" USING btree ("round_order");--> statement-breakpoint
CREATE INDEX "players_club_idx" ON "players" USING btree ("club_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_league_player_uq" ON "roster_slots" USING btree ("league_id","player_id");--> statement-breakpoint
CREATE INDEX "roster_team_idx" ON "roster_slots" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "waiver_league_idx" ON "waiver_claims" USING btree ("league_id","status");