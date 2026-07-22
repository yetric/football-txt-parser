/**
 * Canonical output types for a parsed Football.TXT file.
 */

export interface FootballTxtTeam {
    /** Stable identifier derived from the team name, e.g. "ftxt:germany" */
    externalId: string;
    name: string;
}

export interface FootballTxtMatch {
    /** Stable dedup key, e.g. "ftxt:euro-2024-12" */
    externalId: string;
    /**
     * Stage identifier.
     * Common values: GROUP_STAGE | ROUND_OF_32 | ROUND_OF_16 | QUARTER_FINALS |
     * SEMI_FINALS | THIRD_PLACE | FINAL | PLAYOFF
     */
    stage: string;
    /** "Group A" … "Group H" — null for knockout matches */
    group: string | null;
    /** Not derivable from the txt format — always null */
    matchday: number | null;
    /** ISO 8601 datetime string (UTC) */
    kickoff: string;
    homeTeamExternalId: string;
    awayTeamExternalId: string;
    homeScore: number | null;
    awayScore: number | null;
    /** Populated only when the match went to a penalty shootout */
    homeScorePenalties: number | null;
    awayScorePenalties: number | null;
    status: "SCHEDULED" | "FINISHED";
    venue: string | null;
}

export interface FootballTxtStandingEntry {
    teamExternalId: string;
    position: number;
    played: number;
    won: number;
    drawn: number;
    lost: number;
    goalsFor: number;
    goalsAgainst: number;
    points: number;
}

export interface FootballTxtGroupStanding {
    /** Always "GROUP_STAGE" */
    stage: string;
    /** e.g. "Group A" */
    group: string;
    entries: FootballTxtStandingEntry[];
}

export interface FootballTxtCompetition {
    slug: string;
    name: string;
    country: string;
    isTournament: boolean;
}

export interface FootballTxtSeason {
    /** Start year of the season, e.g. 2025 for a 2025-26 league season */
    year: number;
    /** ISO date string */
    startDate: string;
    /** ISO date string */
    endDate: string;
}

export interface FootballTxtData {
    competition: FootballTxtCompetition;
    season: FootballTxtSeason;
    teams: FootballTxtTeam[];
    matches: FootballTxtMatch[];
    /** Group-stage standings. Empty array for knockout-only competitions. */
    standings: FootballTxtGroupStanding[];
}
