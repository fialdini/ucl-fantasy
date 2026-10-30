import type { SubPosition } from "@/domain/subpositions";
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const positionEnum = pgEnum("position", ["GK", "DEF", "MID", "FWD"]);
export const stageEnum = pgEnum("stage", ["LEAGUE", "PLAYOFF", "R16", "QF", "SF", "FINAL"]);
export const matchStatusEnum = pgEnum("match_status", ["SCHEDULED", "LIVE", "FINISHED", "POSTPONED", "CANCELLED"]);
export const statsStatusEnum = pgEnum("stats_status", ["NONE", "PARTIAL", "FINAL"]);
export const leagueStatusEnum = pgEnum("league_status", ["SETUP", "DRAFTING", "ACTIVE", "COMPLETE"]);
export const slotEnum = pgEnum("slot", ["STARTER", "BENCH"]);
export const matchupKindEnum = pgEnum("matchup_kind", ["REGULAR", "SEMI", "FINAL"]);
export const matchupStatusEnum = pgEnum("matchup_status", ["SCHEDULED", "PARTIAL", "FINAL"]);
export const waiverStatusEnum = pgEnum("waiver_status", ["PENDING", "SUCCEEDED", "FAILED", "CANCELLED"]);
export const tradeStatusEnum = pgEnum("trade_status", ["PENDING", "REVIEW", "ACCEPTED", "REJECTED", "CANCELLED", "FAILED", "VETOED"]);
export const syncStatusEnum = pgEnum("sync_status", ["RUNNING", "SUCCESS", "PARTIAL", "ERROR"]);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// ---------- Usuários ----------

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
});

// ---------- Dados reais (chaves = IDs do provider) ----------

export const clubs = pgTable("clubs", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  logoUrl: text("logo_url"),
  /** Ordem da última rodada disputada antes da eliminação; null = ainda vivo. */
  eliminatedAfterRound: integer("eliminated_after_round"),
});

export const players = pgTable(
  "players",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    position: positionEnum("position").notNull(),
    clubId: integer("club_id")
      .notNull()
      .references(() => clubs.id),
    photoUrl: text("photo_url"),
    /** Sub-posição (ver domain/subpositions): GK, CB, FB, DM, AM, WG, ST. */
    subPosition: text("sub_position").$type<SubPosition>().notNull().default("AM"),
    /** false = sumiu do elenco inscrito (transferido/desligado). Continua no histórico. */
    active: boolean("active").notNull().default(true),
    injured: boolean("injured").notNull().default(false),
    /** Previsão de retorno da lesão, como a fonte informa (ex.: "Late November 2026", "Doubtful"). */
    injuryReturn: text("injury_return"),
    injuryUpdatedAt: ts("injury_updated_at"),
    /** Quem registrou: o comissário (MANUAL, só ele altera) ou a leitura automática de súmulas (AUTO). */
    injurySource: text("injury_source").$type<"MANUAL" | "AUTO">(),
    /** Por que a leitura automática marcou dúvida (ex.: "Fora da relação do último jogo"). */
    injuryNote: text("injury_note"),
    /** AAAA-MM-DD; usada para cruzar o jogador com outras fontes (lesões). */
    birthDate: text("birth_date"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("players_club_idx").on(t.clubId)],
);

/** Técnicos reais dos clubes (vêm das súmulas). Cada time fantasy pode ter um. */
export const coaches = pgTable(
  "coaches",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    clubId: integer("club_id")
      .notNull()
      .references(() => clubs.id),
    photoUrl: text("photo_url"),
    /** false = não aparece mais como técnico principal do clube. */
    active: boolean("active").notNull().default(true),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("coaches_club_idx").on(t.clubId)],
);

export const rounds = pgTable("rounds", {
  order: integer("order").primaryKey(),
  stage: stageEnum("stage").notNull(),
  leg: integer("leg"),
  name: text("name").notNull(),
  firstKickoff: ts("first_kickoff"),
  lastKickoff: ts("last_kickoff"),
  /** Fechada = pontos finais e confrontos decididos. */
  closedAt: ts("closed_at"),
});

export const matches = pgTable(
  "matches",
  {
    id: integer("id").primaryKey(),
    roundOrder: integer("round_order")
      .notNull()
      .references(() => rounds.order),
    homeClubId: integer("home_club_id")
      .notNull()
      .references(() => clubs.id),
    awayClubId: integer("away_club_id")
      .notNull()
      .references(() => clubs.id),
    kickoff: ts("kickoff").notNull(),
    status: matchStatusEnum("status").notNull(),
    homeGoals: integer("home_goals"),
    awayGoals: integer("away_goals"),
    homePenalties: integer("home_penalties"),
    awayPenalties: integer("away_penalties"),
    statsStatus: statsStatusEnum("stats_status").notNull().default("NONE"),
    statsFetchedAt: ts("stats_fetched_at"),
    statsError: text("stats_error"),
  },
  (t) => [index("matches_round_idx").on(t.roundOrder)],
);

export const playerMatchStats = pgTable(
  "player_match_stats",
  {
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id),
    roundOrder: integer("round_order").notNull(),
    clubId: integer("club_id").notNull(),
    /** Posição usada na pontuação (do cadastro do jogador no momento do cálculo). */
    position: positionEnum("position").notNull(),
    minutes: integer("minutes").notNull(),
    goals: integer("goals").notNull(),
    assists: integer("assists").notNull(),
    shotsOnTarget: integer("shots_on_target").notNull().default(0),
    shotsWoodwork: integer("shots_woodwork").notNull().default(0),
    shotsOffTarget: integer("shots_off_target").notNull().default(0),
    tackles: integer("tackles").notNull().default(0),
    ballsRecovered: integer("balls_recovered").notNull().default(0),
    dribbles: integer("dribbles").notNull().default(0),
    passesCompleted: integer("passes_completed").notNull().default(0),
    passesMissed: integer("passes_missed").notNull().default(0),
    offsides: integer("offsides").notNull().default(0),
    foulsCommitted: integer("fouls_committed").notNull().default(0),
    foulsSuffered: integer("fouls_suffered").notNull().default(0),
    penaltiesWon: integer("penalties_won").notNull().default(0),
    penaltiesConceded: integer("penalties_conceded").notNull().default(0),
    ownGoals: integer("own_goals").notNull(),
    yellowCards: integer("yellow_cards").notNull(),
    redCards: integer("red_cards").notNull(),
    saves: integer("saves").notNull(),
    goalsConceded: integer("goals_conceded").notNull(),
    penaltiesSaved: integer("penalties_saved").notNull(),
    penaltiesMissed: integer("penalties_missed").notNull(),
    cleanSheet: boolean("clean_sheet").notNull(),
    /** Entrou jogando (titular da súmula). Base da leitura automática de lesões. */
    started: boolean("started").notNull().default(false),
    /** Decimal, como no Cartola (ex.: 7,9). */
    points: doublePrecision("points").notNull(),
    breakdown: jsonb("breakdown").$type<Array<{ label: string; points: number }>>().notNull(),
    final: boolean("final").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.matchId] }), index("pms_round_idx").on(t.roundOrder)],
);

/** Cache de todas as respostas do provider — permite reprocessar sem repetir requisições. */
export const apiCache = pgTable("api_cache", {
  key: text("key").primaryKey(),
  provider: text("provider").notNull(),
  endpoint: text("endpoint").notNull(),
  response: jsonb("response").notNull(),
  fetchedAt: ts("fetched_at").notNull(),
});

export const syncLogs = pgTable("sync_logs", {
  id: serial("id").primaryKey(),
  job: text("job").notNull(),
  provider: text("provider").notNull(),
  status: syncStatusEnum("status").notNull(),
  startedAt: ts("started_at").notNull(),
  finishedAt: ts("finished_at"),
  requests: integer("requests").notNull().default(0),
  message: text("message"),
  details: jsonb("details").$type<Record<string, unknown>>(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

// ---------- Fantasy ----------

export const leagues = pgTable("leagues", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  commissionerId: integer("commissioner_id")
    .notNull()
    .references(() => users.id),
  maxTeams: integer("max_teams").notNull(),
  status: leagueStatusEnum("status").notNull().default("SETUP"),
  /** Primeira rodada que conta para a liga (pode começar com a temporada em andamento). */
  startRound: integer("start_round").notNull(),
  /** Segundos por escolha no draft (o comissário pode mudar a qualquer momento). */
  draftPickSeconds: integer("draft_pick_seconds").notNull().default(60),
  /** Horas que uma troca aceita fica em revisão do comissário antes de ser concluída (0 = na hora). */
  tradeReviewHours: integer("trade_review_hours").notNull().default(24),
  draftOrder: jsonb("draft_order").$type<number[]>(),
  draftCurrentPick: integer("draft_current_pick"),
  draftPickDeadline: ts("draft_pick_deadline"),
  /** Janela de waiver aberta: processa nesta data. */
  waiverProcessAt: ts("waiver_process_at"),
  waiverMode: text("waiver_mode").$type<"ROLLING" | "REPECHAGE">(),
  waiverAfterRound: integer("waiver_after_round"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const leagueMembers = pgTable(
  "league_members",
  {
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").$type<"COMMISSIONER" | "MEMBER">().notNull(),
    joinedAt: ts("joined_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.userId] })],
);

export const fantasyTeams = pgTable(
  "fantasy_teams",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    /** Formação da escalação (ver game.formations). */
    formation: text("formation").notNull().default("4-4-2"),
    /** Técnico real do time (um por time; exclusivo na liga). */
    managerId: integer("manager_id").references(() => coaches.id),
  },
  (t) => [uniqueIndex("team_league_user_uq").on(t.leagueId, t.userId), uniqueIndex("team_league_manager_uq").on(t.leagueId, t.managerId)],
);

/** Elenco atual. O índice único (liga, jogador) garante a posse exclusiva. */
export const rosterSlots = pgTable(
  "roster_slots",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    teamId: integer("team_id")
      .notNull()
      .references(() => fantasyTeams.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    slot: slotEnum("slot").notNull(),
    acquiredVia: text("acquired_via").$type<"DRAFT" | "WAIVER" | "FREE_AGENT" | "TRADE">().notNull(),
    acquiredAt: ts("acquired_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("roster_league_player_uq").on(t.leagueId, t.playerId), index("roster_team_idx").on(t.teamId)],
);

/** Escalação congelada no travamento da rodada — base do placar. */
export const lineupSnapshots = pgTable(
  "lineup_snapshots",
  {
    teamId: integer("team_id")
      .notNull()
      .references(() => fantasyTeams.id, { onDelete: "cascade" }),
    roundOrder: integer("round_order").notNull(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    slot: slotEnum("slot").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.roundOrder, t.playerId] })],
);

/** Técnico que valeu em cada rodada (congelado junto com a escalação). */
export const managerSnapshots = pgTable(
  "manager_snapshots",
  {
    teamId: integer("team_id")
      .notNull()
      .references(() => fantasyTeams.id, { onDelete: "cascade" }),
    roundOrder: integer("round_order").notNull(),
    coachId: integer("coach_id")
      .notNull()
      .references(() => coaches.id),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.roundOrder] })],
);

export const draftPicks = pgTable(
  "draft_picks",
  {
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    overall: integer("overall").notNull(),
    round: integer("round").notNull(),
    teamId: integer("team_id")
      .notNull()
      .references(() => fantasyTeams.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    auto: boolean("auto").notNull(),
    pickedAt: ts("picked_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.overall] })],
);

/** Confronto: temporada regular cobre 1 rodada; playoffs somam 2 pernas. */
export const matchups = pgTable(
  "matchups",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    kind: matchupKindEnum("kind").notNull(),
    fromRound: integer("from_round").notNull(),
    toRound: integer("to_round").notNull(),
    homeTeamId: integer("home_team_id")
      .notNull()
      .references(() => fantasyTeams.id, { onDelete: "cascade" }),
    awayTeamId: integer("away_team_id")
      .notNull()
      .references(() => fantasyTeams.id, { onDelete: "cascade" }),
    homePoints: doublePrecision("home_points"),
    awayPoints: doublePrecision("away_points"),
    status: matchupStatusEnum("status").notNull().default("SCHEDULED"),
    /** null + FINAL = empate (temporada regular). */
    winnerTeamId: integer("winner_team_id"),
  },
  (t) => [index("matchups_league_idx").on(t.leagueId, t.fromRound)],
);

export const waiverClaims = pgTable(
  "waiver_claims",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    teamId: integer("team_id")
      .notNull()
      .references(() => fantasyTeams.id, { onDelete: "cascade" }),
    addPlayerId: integer("add_player_id")
      .notNull()
      .references(() => players.id),
    /** null = sem dispensa (havia vaga no elenco). */
    dropPlayerId: integer("drop_player_id").references(() => players.id),
    /** Preferência do próprio time (1 = mais desejado). */
    preference: integer("preference").notNull(),
    status: waiverStatusEnum("status").notNull().default("PENDING"),
    failReason: text("fail_reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [index("waiver_league_idx").on(t.leagueId, t.status)],
);

/** Proposta de troca entre dois times da liga (estilo NFL Fantasy). */
export const trades = pgTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    proposerTeamId: integer("proposer_team_id")
      .notNull()
      .references(() => fantasyTeams.id, { onDelete: "cascade" }),
    receiverTeamId: integer("receiver_team_id")
      .notNull()
      .references(() => fantasyTeams.id, { onDelete: "cascade" }),
    status: tradeStatusEnum("status").notNull().default("PENDING"),
    message: text("message"),
    failReason: text("fail_reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
    respondedAt: ts("responded_at"),
    /** Em revisão: é concluída automaticamente nesta data, se o comissário não vetar antes. */
    reviewEndsAt: ts("review_ends_at"),
  },
  (t) => [index("trades_league_idx").on(t.leagueId, t.status)],
);

/** Jogadores de uma proposta; `fromTeamId` é quem cede o jogador. */
export const tradeItems = pgTable(
  "trade_items",
  {
    tradeId: integer("trade_id")
      .notNull()
      .references(() => trades.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    fromTeamId: integer("from_team_id")
      .notNull()
      .references(() => fantasyTeams.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.tradeId, t.playerId] })],
);

/**
 * Histórico de temporadas anteriores (só exibição na página do jogador). Guarda a estatística bruta;
 * os pontos são calculados na leitura com a tabela atual. Sem chave estrangeira para jogador/clube:
 * quem jogou a temporada passada pode não estar nesta.
 */
export const playerHistory = pgTable(
  "player_history",
  {
    seasonYear: integer("season_year").notNull(),
    matchId: integer("match_id").notNull(),
    playerId: integer("player_id").notNull(),
    roundOrder: integer("round_order").notNull(),
    kickoff: ts("kickoff").notNull(),
    clubName: text("club_name").notNull(),
    opponentName: text("opponent_name").notNull(),
    home: boolean("home").notNull(),
    position: positionEnum("position").notNull(),
    stats: jsonb("stats").$type<Record<string, number>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.seasonYear, t.matchId, t.playerId] }), index("history_player_idx").on(t.playerId)],
);
