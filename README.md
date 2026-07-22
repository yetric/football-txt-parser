# @yetric/football-txt-parser

A TypeScript parser for the [openfootball](https://github.com/openfootball) `Football.TXT` format — the plain-text
football data format used by repos like [openfootball/euro](https://github.com/openfootball/euro) and
[openfootball/copa-america](https://github.com/openfootball/copa-america).

It turns a `.txt` file's raw contents into structured competition, team, match, and standings data. No network
calls, no side effects — just parsing.

## Why

The openfootball `Football.TXT` format has quietly evolved several incompatible match-line layouts over the years
(see [openfootball/spec](https://github.com/openfootball/spec)), plus format-specific quirks: secondary timezones,
penalty-shootout notation, two-year league seasons that roll over calendar years, "v"-separated UCL/Europa League
fixtures, and more. This package handles all of that so you don't have to.

## Install

```sh
npm install @yetric/football-txt-parser
```

## Usage

```ts
import { parseFootballTxt } from "@yetric/football-txt-parser";

const res = await fetch("https://raw.githubusercontent.com/openfootball/euro/master/2024/euro.2024.txt");
const text = await res.text();

const data = parseFootballTxt(
    text,
    { slug: "euro-2024", name: "UEFA Euro 2024", country: "Europe", isTournament: true },
    2024,
);

data.competition; // { slug, name, country, isTournament }
data.season; // { year, startDate, endDate }
data.teams; // [{ externalId, name }, ...]
data.matches; // [{ externalId, stage, group, kickoff, homeTeamExternalId, ... }, ...]
data.standings; // group-stage tables, computed from match results
```

## Supported match-line formats

| Format              | Example                                                             |
| ------------------- | ------------------------------------------------------------------- |
| Modern              | `Fri Jun/14 21:00  Germany  5-1  Scotland  @ Munich Football Arena` |
| Old Euro            | `June 12   @ National Arena, Warsaw   Poland  1-1  Greece`          |
| Copa (numbered)     | `(1) Fri Jun/14 20:00  Argentina  2-0  Canada  @ MetLife Stadium`   |
| UCL / Europa League | `Wed Sep/18 2024   Real Madrid (ESP)  v  VfB Stuttgart (GER)  3-1`  |

Handles extra-time and penalty-shootout notation (`2-1 a.e.t.`, `4-2 pen. (1-1)`), group tables, knockout stage
headers, and year rollovers for two-year league seasons.

## What it doesn't do

This package only parses. It doesn't fetch files, cache anything, or persist to a database — bring your own HTTP
client and storage layer.

## License

MIT
