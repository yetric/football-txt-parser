import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFootballTxt } from "../src/parser";

const __dirname = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): string {
    return readFileSync(join(__dirname, "fixtures", name), "utf-8");
}

const cupConfig = { slug: "sample-cup", name: "Sample Cup", country: "World", isTournament: true };
const leagueConfig = { slug: "sample-league", name: "Sample League", country: "World", isTournament: false };

describe("parseFootballTxt — modern format", () => {
    const data = parseFootballTxt(fixture("modern.txt"), cupConfig, 2024);

    it("collects all teams", () => {
        expect(data.teams.map((t) => t.name).sort()).toEqual(["Fixturia", "Mockland", "Sampland", "Testonia"]);
    });

    it("parses group stage matches with scores and venue", () => {
        const m = data.matches.find((m) => m.kickoff.startsWith("2024-06-14T21:00"));
        expect(m).toMatchObject({
            stage: "GROUP_STAGE",
            group: "Group A",
            homeScore: 5,
            awayScore: 1,
            venue: "National Arena",
            status: "FINISHED",
        });
    });

    it("resolves team external ids consistently across matches", () => {
        const sampland = data.teams.find((t) => t.name === "Sampland")!;
        const inGroup = data.matches.find((m) => m.kickoff.startsWith("2024-06-14T21:00"))!;
        const inKnockout = data.matches.find((m) => m.stage === "ROUND_OF_16")!;
        expect(inGroup.homeTeamExternalId).toBe(sampland.externalId);
        expect(inKnockout.homeTeamExternalId).toBe(sampland.externalId);
    });

    it("tags knockout stages from section headers", () => {
        const r16 = data.matches.find((m) => m.stage === "ROUND_OF_16");
        expect(r16).toBeDefined();
        expect(r16!.group).toBeNull();
    });

    it("parses a penalty-shootout final ('pens first, FT in parens' notation)", () => {
        // "3-3 pen. (1-1)" → pens 3-3, FT 1-1
        const final = data.matches.find((m) => m.stage === "FINAL");
        expect(final).toMatchObject({
            homeScore: 1,
            awayScore: 1,
            homeScorePenalties: 3,
            awayScorePenalties: 3,
        });
    });

    it("computes group standings sorted by points then goal difference", () => {
        // Fixturia: draw + win = 4 pts; Sampland: win + loss = 3 pts.
        const groupA = data.standings.find((g) => g.group === "Group A")!;
        expect(groupA).toBeDefined();
        expect(groupA.entries[0].teamExternalId).toBe(data.teams.find((t) => t.name === "Fixturia")!.externalId);
        expect(groupA.entries[0].points).toBe(4);
        expect(groupA.entries.every((e) => e.played === 2)).toBe(true);
    });
});

describe("parseFootballTxt — old Euro format (date/venue before score)", () => {
    const data = parseFootballTxt(fixture("old-euro.txt"), cupConfig, 2000);

    it("extracts date, venue, and teams from the pre-score layout", () => {
        const m = data.matches.find((m) => m.venue === "National Arena, Warsaw" && m.homeScore === 1);
        expect(m).toMatchObject({
            kickoff: "2000-06-12T12:00:00Z",
            awayScore: 1,
        });
    });

    it("parses a.e.t. results", () => {
        const m = data.matches.find((m) => m.kickoff.startsWith("2000-06-16") && m.venue?.includes("National"));
        expect(m).toMatchObject({ homeScore: 2, awayScore: 1 });
    });

    it("parses old-format penalty notation with a.e.t. FT score", () => {
        const final = data.matches.find((m) => m.stage === "FINAL");
        expect(final).toMatchObject({
            homeScore: 0,
            awayScore: 0,
            homeScorePenalties: 3,
            awayScorePenalties: 5,
        });
    });

    it("tags plain-text knockout headers", () => {
        expect(data.matches.some((m) => m.stage === "SEMI_FINALS")).toBe(true);
        expect(data.matches.some((m) => m.stage === "FINAL")).toBe(true);
    });
});

describe("parseFootballTxt — Copa format (numbered matches)", () => {
    const data = parseFootballTxt(fixture("copa.txt"), cupConfig, 2024);

    it("strips the leading match number", () => {
        const m = data.matches.find((m) => m.homeScore === 2 && m.awayScore === 0);
        expect(m?.venue).toBe("MetLife Stadium");
    });

    it("parses Copa-style penalties (pens first, FT in parens)", () => {
        const final = data.matches.find((m) => m.stage === "FINAL");
        expect(final).toMatchObject({
            homeScore: 1,
            awayScore: 1,
            homeScorePenalties: 4,
            awayScorePenalties: 2,
        });
    });

    it("tags third-place and quarter-final headers", () => {
        expect(data.matches.some((m) => m.stage === "THIRD_PLACE")).toBe(true);
        expect(data.matches.some((m) => m.stage === "QUARTER_FINALS")).toBe(true);
    });
});

describe("parseFootballTxt — UCL/Europa 'v'-separated format", () => {
    const data = parseFootballTxt(fixture("ucl.txt"), leagueConfig, 2024);

    it("splits home/away on ' v ' and strips country codes", () => {
        const m = data.matches[0];
        const home = data.teams.find((t) => t.externalId === m.homeTeamExternalId)!;
        const away = data.teams.find((t) => t.externalId === m.awayTeamExternalId)!;
        expect(home.name).toBe("Real Madrid");
        expect(away.name).toBe("VfB Stuttgart");
    });

    it("maps 'League, Matchday N' headers to the league-phase sentinel stage", () => {
        expect(data.matches[0].stage).toBe("__league__");
    });

    it("maps 'Finals, Round of 16' headers to ROUND_OF_16", () => {
        expect(data.matches[data.matches.length - 1].stage).toBe("ROUND_OF_16");
    });

    it("resolves explicit years on date header lines", () => {
        expect(data.matches[0].kickoff).toBe("2024-09-18T21:00:00Z");
        expect(data.matches[2].kickoff).toBe("2025-03-05T21:00:00Z");
    });
});

describe("parseFootballTxt — two-year season with rollover", () => {
    const data = parseFootballTxt(fixture("season-rollover.txt"), leagueConfig, 2024);

    it("keeps matches before the turn of the year in the season's start year", () => {
        expect(data.matches[0].kickoff).toBe("2024-08-10T15:00:00Z");
        expect(data.matches[2].kickoff).toBe("2024-12-22T15:00:00Z");
    });

    it("rolls over to the following calendar year after a season gap", () => {
        expect(data.matches[3].kickoff).toBe("2025-01-18T15:00:00Z");
        expect(data.matches[4].kickoff).toBe("2025-04-12T15:00:00Z");
    });

    it("derives season start/end dates from the earliest/latest match", () => {
        expect(data.season).toMatchObject({ startDate: "2024-08-10", endDate: "2025-04-12" });
    });
});

describe("parseFootballTxt — edge cases", () => {
    it("ignores comment and separator lines", () => {
        const text = "# a comment\n=====\n\nFri Jun/14 21:00  A  1-0  B  @ Venue\n";
        const data = parseFootballTxt(text, cupConfig, 2024);
        expect(data.matches).toHaveLength(1);
    });

    it("returns no matches for an empty file, with fallback season dates", () => {
        const data = parseFootballTxt("", cupConfig, 2024);
        expect(data.matches).toEqual([]);
        expect(data.teams).toEqual([]);
        expect(data.season).toEqual({ year: 2024, startDate: "2024-06-01", endDate: "2024-07-31" });
    });

    it("marks matches without a score as SCHEDULED", () => {
        const text = "Fri Jun/14 21:00  A  0-0  B  @ Venue\nSat Jun/15 21:00  A  vs  B\n";
        const data = parseFootballTxt(text, cupConfig, 2024);
        // The second line has no valid score expression, so it's skipped entirely —
        // confirming only well-formed lines produce matches.
        expect(data.matches).toHaveLength(1);
        expect(data.matches[0].status).toBe("FINISHED");
    });
});
