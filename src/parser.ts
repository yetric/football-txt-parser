/**
 * Parses the openfootball Football.TXT format.
 *
 * Supports the tournament format used by euro/, copa-america/ repos:
 *   https://github.com/openfootball/euro
 *   https://github.com/openfootball/copa-america
 *
 * Handles three historical match-line formats:
 *   A (modern):  "HH:MM  HomeTeam  Score  AwayTeam  @ Venue"
 *   B (old Euro):"Date [Time] @ Venue  HomeTeam  Score  AwayTeam"
 *   C (Copa):    "(N) DayOfWeek Mon/DD HH:MM  HomeTeam  Score  AwayTeam  @ Venue"
 *
 * Format spec: https://github.com/openfootball/spec
 */

import type {
    FootballTxtCompetition,
    FootballTxtData,
    FootballTxtGroupStanding,
    FootballTxtMatch,
    FootballTxtTeam,
} from "./types";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Both abbreviated (Jun) and full (June / July) month names */
const MONTHS: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
};

/**
 * Parse a month-day token like "Jun/14", "June 14", "Jul/1" into an ISO date.
 * Accepts 3–9 letter month names separated by "/" or space from the day.
 */
function parseMonthDay(token: string, year: number): string | null {
    const m = token.trim().match(/^([A-Za-z]{3,9})[/\s](\d{1,2})$/);
    if (!m) return null;
    const month = MONTHS[m[1].toLowerCase()];
    if (!month) return null;
    const day = Number(m[2]);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse a full "MonthName Day" date like "June 12" or "July 8".
 * Returns ISO date string or null.
 */
function parseFullMonthDay(s: string, year: number): string | null {
    const m = s.trim().match(/^([A-Za-z]{4,9})\s+(\d{1,2})\b/);
    if (!m) return null;
    const month = MONTHS[m[1].toLowerCase()];
    if (!month) return null;
    const day = Number(m[2]);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Score parsing
// ---------------------------------------------------------------------------

/**
 * Full score expression — ordered by specificity (longest match first):
 *   "3-5 pen. 0-0 a.e.t. (0-0)"  — decided by penalties (old euro format)
 *   "4-2 pen. (1-1)"              — decided by penalties (Copa format: pens first, FT in parens)
 *   "2-1 a.e.t. (1-0)"            — after extra time
 *   "2-1 (1-0)"                    — normal with half-time
 *   "2-1"                          — normal
 */
const SCORE_RE =
    /\b(\d+-\d+\s+pen\.\s+\d+-\d+\s+a\.e\.t\.(?:\s*\(\d+-\d+\))?|\d+-\d+\s+pen\.\s*\(\d+-\d+\)|\d+-\d+\s+a\.e\.t\.(?:\s*\(\d+-\d+\))?|\d+-\d+(?:\s*\(\d+-\d+\))?)/;

interface ScoreResult {
    homeScore: number | null;
    awayScore: number | null;
    homePen: number | null;
    awayPen: number | null;
}

function parseScoreExpr(expr: string): ScoreResult {
    // "3-5 pen. 0-0 a.e.t." → FT: 0-0, Pen: 3-5 (old euro format)
    const penAet = expr.match(/(\d+)-(\d+)\s+pen\.\s+(\d+)-(\d+)\s+a\.e\.t\./);
    if (penAet) {
        return {
            homeScore: Number(penAet[3]),
            awayScore: Number(penAet[4]),
            homePen: Number(penAet[1]),
            awayPen: Number(penAet[2]),
        };
    }
    // "4-2 pen. (1-1)" → FT: 1-1, Pen: 4-2 (Copa format: pens first, FT in parens)
    const penCopa = expr.match(/(\d+)-(\d+)\s+pen\.\s*\((\d+)-(\d+)\)/);
    if (penCopa) {
        return {
            homeScore: Number(penCopa[3]),
            awayScore: Number(penCopa[4]),
            homePen: Number(penCopa[1]),
            awayPen: Number(penCopa[2]),
        };
    }
    // "2-1 a.e.t."
    const aet = expr.match(/(\d+)-(\d+)\s+a\.e\.t\./);
    if (aet) {
        return { homeScore: Number(aet[1]), awayScore: Number(aet[2]), homePen: null, awayPen: null };
    }
    // "2-1" or "2-1 (1-0)"
    const ft = expr.match(/^(\d+)-(\d+)/);
    if (!ft) return { homeScore: null, awayScore: null, homePen: null, awayPen: null };
    return { homeScore: Number(ft[1]), awayScore: Number(ft[2]), homePen: null, awayPen: null };
}

// ---------------------------------------------------------------------------
// Stage / section mapping
// ---------------------------------------------------------------------------

function mapSection(section: string): { stage: string; group: string | null } {
    const s = section.toLowerCase().trim();
    // New CL league phase format: "League, Matchday N" / "Finals, Round of 16" / "Playoffs, ..."
    if (s.startsWith("league,")) return { stage: "__league__", group: null };
    if (s.startsWith("playoffs,")) return { stage: "PLAYOFF", group: null };
    if (s.startsWith("finals,")) return mapSection(s.slice("finals,".length).trim());
    const groupMatch = s.match(/^group\s+([a-z])$/);
    if (groupMatch) return { stage: "GROUP_STAGE", group: `Group ${groupMatch[1].toUpperCase()}` };
    if (/matchday\s*\d+/.test(s)) return { stage: "GROUP_STAGE", group: null };
    if (s.includes("round of 16") || s.includes("round of sixteen")) return { stage: "ROUND_OF_16", group: null };
    if (s.includes("round of 32")) return { stage: "ROUND_OF_32", group: null };
    if (s.includes("quarterfinal") || s.includes("quarter-final")) return { stage: "QUARTER_FINALS", group: null };
    if (s.includes("semifinal") || s.includes("semi-final")) return { stage: "SEMI_FINALS", group: null };
    if (s === "final") return { stage: "FINAL", group: null };
    if (s.includes("third") || s.includes("3rd")) return { stage: "THIRD_PLACE", group: null };
    if (s.includes("playoff") || s.includes("play-off")) return { stage: "PLAYOFF", group: null };
    return { stage: "GROUP_STAGE", group: null };
}

/**
 * Try to detect plain-text knockout section headers (Copa style, no ▪/:: prefix).
 * Returns null if the line isn't a recognizable knockout stage header.
 */
function tryMapKnockoutSection(line: string): { stage: string; group: string | null } | null {
    const s = line.toLowerCase().trim();
    if (s.includes("round of 16") || s.includes("round of sixteen")) return { stage: "ROUND_OF_16", group: null };
    if (s.includes("round of 32")) return { stage: "ROUND_OF_32", group: null };
    if (s.includes("quarterfinal") || s.includes("quarter-final")) return { stage: "QUARTER_FINALS", group: null };
    if (s.includes("semifinal") || s.includes("semi-final")) return { stage: "SEMI_FINALS", group: null };
    if (s === "final") return { stage: "FINAL", group: null };
    if (s.includes("third") || s.includes("3rd")) return { stage: "THIRD_PLACE", group: null };
    if (s.includes("playoff") || s.includes("play-off")) return { stage: "PLAYOFF", group: null };
    return null;
}

// ---------------------------------------------------------------------------
// Match line parsing
// ---------------------------------------------------------------------------

interface ParsedMatchLine {
    home: string;
    away: string;
    date: string;
    time: string;
    venue: string | null;
    homeScore: number | null;
    awayScore: number | null;
    homePen: number | null;
    awayPen: number | null;
}

function tryParseMatchLine(line: string, currentDate: string | null, year: number): ParsedMatchLine | null {
    const raw = line.trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("=")) return null;

    const scoreMatch = SCORE_RE.exec(raw);
    if (!scoreMatch) return null;

    const scoreExpr = scoreMatch[1];
    const scoreStart = scoreMatch.index;
    const scoreEnd = scoreStart + scoreExpr.length;

    let prefix = raw.slice(0, scoreStart);
    const suffix = raw.slice(scoreEnd);

    // Strip match number "(1) " or "(23) "
    prefix = prefix.replace(/^\s*\(\d+\)\s*/, "");

    let detectedDate = currentDate;
    let time = "12:00";
    let home: string;
    let away: string;
    let venue: string | null = null;

    // ── Old Euro format: "Date [Time] @ Venue  HomeTeam" before score ────────
    if (prefix.includes("@")) {
        const atIdx = prefix.indexOf("@");
        const beforeAt = prefix.slice(0, atIdx);
        const afterAt = prefix.slice(atIdx + 1);

        // Try to extract date from beforeAt (e.g. "June 12 " or "June 8   ")
        const fullMonthDate = parseFullMonthDay(beforeAt.trim(), year);
        if (fullMonthDate) {
            detectedDate = fullMonthDate;
        }

        // Try to extract time from beforeAt (e.g. " 18:00 " after stripping date)
        const timeInBefore = beforeAt.match(/(\d{1,2}:\d{2})/);
        if (timeInBefore) time = timeInBefore[1];

        // Extract venue and home team from afterAt separated by 2+ spaces
        const parts = afterAt
            .split(/\s{2,}/)
            .map((s) => s.trim())
            .filter(Boolean);
        venue = parts[0] ?? null;
        home = parts[parts.length - 1] ?? "";

        // Away team is everything in suffix before any annotation
        away = suffix
            .trim()
            .replace(/\s*\([^)]*\)\s*$/, "")
            .trim();

        // ── Modern format: "HomeTeam" in prefix, "AwayTeam @ Venue" in suffix ────
    } else {
        // Day-of-week + month/day: "Thu Jun/20 " or "Fri Jun 14 "
        const dowDate = prefix.match(/^([A-Za-z]{3})\s+([A-Za-z]{3,9}[/\s]\d{1,2})\s+/);
        if (dowDate) {
            const d = parseMonthDay(dowDate[2], year);
            if (d) detectedDate = d;
            prefix = prefix.slice(dowDate[0].length);
        } else {
            // Just "Mon/Day" or "Mon Day"
            const justDate = prefix.match(/^([A-Za-z]{3,9}[/\s]\d{1,2})\s+/);
            if (justDate) {
                const d = parseMonthDay(justDate[1], year);
                if (d) detectedDate = d;
                prefix = prefix.slice(justDate[0].length);
            }
        }

        // Time "20:00" or "15.00" (England txt uses dot) — may be followed by secondary timezone
        const timeMatch = prefix.match(/^(\d{1,2}[:.]\d{2})(?:\s*\([^)]+\))?\s*/);
        if (timeMatch) {
            time = timeMatch[1].replace(".", ":");
            prefix = prefix.slice(timeMatch[0].length);
        }

        home = prefix.trim();

        // Suffix: "  AwayTeam  @ Venue  (UTC+2)"
        const atIdx = suffix.indexOf("@");
        if (atIdx >= 0) {
            away = suffix.slice(0, atIdx).trim();
            venue =
                suffix
                    .slice(atIdx + 1)
                    .trim()
                    .replace(/\s*\(UTC[+-]\d+\)\s*$/, "")
                    .trim() || null;
        } else {
            away = suffix
                .trim()
                .replace(/\s*\([^)]*\)\s*$/, "")
                .trim();
        }

        // UCL/EL/UECL format: "HomeTeam (CTRY)   v  AwayTeam (CTRY)" — both teams before score.
        // When away is empty after suffix parsing, split home on " v ".
        if (!away) {
            const vMatch = home.match(/^(.+?)\s+v\s+(.+)$/);
            if (vMatch) {
                home = vMatch[1].trim();
                away = vMatch[2].trim();
            }
        }
    }

    if (!home || !away || !detectedDate) return null;

    return {
        home,
        away,
        date: detectedDate,
        time,
        venue,
        ...parseScoreExpr(scoreExpr),
    };
}

// ---------------------------------------------------------------------------
// External ID helper
// ---------------------------------------------------------------------------

/** Strip trailing country codes like "(ENG)", "(GER)" from team names (UCL/EL format) */
function cleanTeamName(name: string): string {
    return name.replace(/\s*\([A-Z]{2,3}\)$/, "").trim();
}

function toExternalId(name: string): string {
    return `ftxt:${name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FootballTxtCompetitionConfig {
    slug: string;
    name: string;
    country: string;
    isTournament: boolean;
}

/**
 * Parse the full contents of an openfootball Football.TXT file into
 * structured competition/team/match/standings data.
 *
 * @param text openfootball Football.TXT file contents
 * @param config metadata describing the competition this file belongs to
 * @param year the season's start year (used to resolve month/day dates and
 *   to detect year rollovers for two-year league seasons)
 */
export function parseFootballTxt(text: string, config: FootballTxtCompetitionConfig, year: number): FootballTxtData {
    const lines = text.split("\n");

    // First pass: collect group definitions
    const teamToGroup = new Map<string, string>();
    for (const line of lines) {
        const gd = line.match(/^Group\s+([A-Z])\s*\|\s*(.+)/i);
        if (gd) {
            const groupName = `Group ${gd[1].toUpperCase()}`;
            const teams = gd[2]
                .trim()
                .split(/\s{2,}/)
                .map((t) => t.trim())
                .filter(Boolean);
            for (const t of teams) teamToGroup.set(t, groupName);
        }
    }

    // Second pass: parse matches
    let currentDate: string | null = null;
    let currentYear = year; // may advance for two-year leagues (e.g. Aug 2016 → Apr 2017)
    let currentStage = "GROUP_STAGE";
    let currentGroup: string | null = null;

    const teamMap = new Map<string, FootballTxtTeam>();
    const matchList: FootballTxtMatch[] = [];
    let idx = 0;

    for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("=")) continue;
        if (/^Group\s+[A-Z]\s*\|/i.test(trimmed)) continue;

        // Section headers starting with ▪, ::, or » (UCL/EL format)
        if (trimmed.startsWith("▪") || trimmed.startsWith("::") || trimmed.startsWith("»")) {
            const section = trimmed
                .replace(/^[▪:»]+\s*/, "")
                .split("|")[0]
                .trim();
            const mapped = mapSection(section);
            currentStage = mapped.stage;
            currentGroup = mapped.group;
            continue;
        }

        // Standalone "Group A" header (copa style)
        if (/^Group\s+[A-Z]\s*$/i.test(trimmed)) {
            const mapped = mapSection(trimmed);
            currentStage = mapped.stage;
            currentGroup = mapped.group;
            continue;
        }

        // "Matchday N | ..." header (copa style)
        if (/^Matchday\s+\d+/i.test(trimmed)) {
            currentStage = "GROUP_STAGE";
            currentGroup = null;
            continue;
        }

        // Date-only lines (no score)
        if (!SCORE_RE.test(trimmed)) {
            // Helper: set currentDate with year-rollover detection for two-year league files.
            // If the new month is less than the previously set month (e.g. Jan after Dec),
            // we've crossed into the next calendar year.
            const applyDate = (monthNum: number, day: number) => {
                if (currentDate) {
                    const prevMonth = Number(currentDate.slice(5, 7));
                    if (monthNum < prevMonth - 3) currentYear++; // rollover (e.g. Dec→Jan)
                }
                currentDate = `${currentYear}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            };

            // "[Sat Aug/6]" or "[Sun Apr/30]" — England txt format
            const bracketDate = trimmed.match(/^\[[A-Za-z]{3}\s+([A-Za-z]{3,9})[/\s](\d{1,2})\]$/);
            if (bracketDate) {
                const month = MONTHS[bracketDate[1].toLowerCase()];
                if (month) {
                    applyDate(month, Number(bracketDate[2]));
                }
                continue;
            }
            // "Fri Jun 14" or "Thu Jun/20" or "Wed Sep/15 2021" (UCL/Scotland include explicit year)
            const dowDate = trimmed.match(/^[A-Za-z]{3}\s+([A-Za-z]{3,9})[/\s](\d{1,2})(?:\s+(\d{4}))?\s*$/);
            if (dowDate) {
                const month = MONTHS[dowDate[1].toLowerCase()];
                if (month) {
                    if (dowDate[3]) {
                        // Explicit year — set directly (handles out-of-order rescheduled matchdays)
                        currentYear = Number(dowDate[3]);
                        currentDate = `${currentYear}-${String(month).padStart(2, "0")}-${String(Number(dowDate[2])).padStart(2, "0")}`;
                    } else {
                        applyDate(month, Number(dowDate[2]));
                    }
                }
                continue;
            }
            // "Jun 14" or "Jul/1"
            const justDate = trimmed.match(/^([A-Za-z]{3,9})[/\s](\d{1,2})\s*$/);
            if (justDate) {
                const month = MONTHS[justDate[1].toLowerCase()];
                if (month) {
                    applyDate(month, Number(justDate[2]));
                    continue;
                }
            }
            // "June 20" or "July 8" (full month name, space-separated)
            const fullMonth = trimmed.match(/^([A-Za-z]{4,9})\s+(\d{1,2})\s*$/);
            if (fullMonth) {
                const month = MONTHS[fullMonth[1].toLowerCase()];
                if (month) {
                    applyDate(month, Number(fullMonth[2]));
                    continue;
                }
            }
            // Plain-text knockout section headers (Copa style, no ▪/:: prefix)
            // e.g. "Quarter-finals", "Semi-finals", "Final", "Third place play-off"
            const knockoutSection = tryMapKnockoutSection(trimmed);
            if (knockoutSection) {
                currentStage = knockoutSection.stage;
                currentGroup = knockoutSection.group;
            }
            continue;
        }

        // Try to parse as match line (pass currentYear for inline-date rollover awareness)
        const m = tryParseMatchLine(line, currentDate, currentYear);
        if (!m) continue;

        currentDate = m.date;

        const homeName = cleanTeamName(m.home);
        const awayName = cleanTeamName(m.away);

        const addTeam = (name: string) => {
            if (!teamMap.has(name)) teamMap.set(name, { externalId: toExternalId(name), name });
        };
        addTeam(homeName);
        addTeam(awayName);

        // Only use the teamToGroup fallback for group stage matches; knockout
        // matches must not inherit a group name even if teams belong to a group.
        const group = currentGroup ?? (currentStage === "GROUP_STAGE" ? (teamToGroup.get(homeName) ?? null) : null);

        matchList.push({
            externalId: `ftxt:${config.slug}-${year}-${idx++}`,
            stage: currentStage,
            group,
            matchday: null,
            kickoff: `${m.date}T${m.time}:00Z`,
            homeTeamExternalId: teamMap.get(homeName)!.externalId,
            awayTeamExternalId: teamMap.get(awayName)!.externalId,
            homeScore: m.homeScore,
            awayScore: m.awayScore,
            homeScorePenalties: m.homePen,
            awayScorePenalties: m.awayPen,
            status: m.homeScore !== null ? "FINISHED" : "SCHEDULED",
            venue: m.venue,
        });
    }

    // Group standings
    const standings: FootballTxtGroupStanding[] = [];
    const groupMatches = matchList.filter((m) => m.stage === "GROUP_STAGE" && m.group);
    const groupNames = Array.from(new Set(groupMatches.map((m) => m.group as string))).sort();

    for (const groupName of groupNames) {
        const gm = groupMatches.filter((m) => m.group === groupName);
        const stats = new Map<
            string,
            { p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number }
        >();

        for (const m of gm) {
            if (!stats.has(m.homeTeamExternalId))
                stats.set(m.homeTeamExternalId, { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
            if (!stats.has(m.awayTeamExternalId))
                stats.set(m.awayTeamExternalId, { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
        }
        for (const m of gm) {
            if (m.homeScore == null || m.awayScore == null) continue;
            const h = stats.get(m.homeTeamExternalId)!;
            const a = stats.get(m.awayTeamExternalId)!;
            h.p++;
            a.p++;
            h.gf += m.homeScore;
            h.ga += m.awayScore;
            a.gf += m.awayScore;
            a.ga += m.homeScore;
            if (m.homeScore > m.awayScore) {
                h.w++;
                h.pts += 3;
                a.l++;
            } else if (m.homeScore < m.awayScore) {
                a.w++;
                a.pts += 3;
                h.l++;
            } else {
                h.d++;
                h.pts++;
                a.d++;
                a.pts++;
            }
        }

        const sorted = Array.from(stats.entries()).sort(
            ([, a], [, b]) => b.pts - a.pts || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf,
        );
        standings.push({
            stage: "GROUP_STAGE",
            group: groupName,
            entries: sorted.map(([externalId, s], i) => ({
                teamExternalId: externalId,
                position: i + 1,
                played: s.p,
                won: s.w,
                drawn: s.d,
                lost: s.l,
                goalsFor: s.gf,
                goalsAgainst: s.ga,
                points: s.pts,
            })),
        });
    }

    const dates = matchList.map((m) => m.kickoff.split("T")[0]).sort();

    const competition: FootballTxtCompetition = {
        slug: config.slug,
        name: config.name,
        country: config.country,
        isTournament: config.isTournament,
    };

    return {
        competition,
        season: {
            year,
            startDate: dates[0] ?? `${year}-06-01`,
            endDate: dates[dates.length - 1] ?? `${year}-07-31`,
        },
        teams: Array.from(teamMap.values()),
        matches: matchList,
        standings,
    };
}
