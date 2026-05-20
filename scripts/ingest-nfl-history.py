#!/usr/bin/env python3
"""
ingest-nfl-history.py

Scaffold for ingesting historical NFL stats into normalized CSVs that
later feed the Postgres database backing NFL Prop Edge.

Quick start (stub mode — writes empty schema-only CSVs, no deps):
    python scripts/ingest-nfl-history.py --season 2025 --weeks 1-10
    python scripts/ingest-nfl-history.py --season 2025 --weeks 1-10 --dry-run

Outputs (relative to --out, default `data/`):
    data/raw/         Raw frames straight from each source pull
                      (one file per source; populated when the
                      nflreadpy / nfl_data_py calls below are wired in)
    data/processed/   Normalized CSVs ready for the Prisma loader:
                        games.csv
                        player_week_stats.csv
                        team_week_stats.csv
                        snap_counts.csv
                        player_ids.csv

Data source (no API keys required):
    nflverse-data releases on GitHub. Wrappers:
        nflreadpy   — Polars-first, actively maintained
        nfl_data_py — Pandas-based (legacy, but stable)

V1 scope: lower-variance markets only. We do not ingest touchdown
columns; they get dropped at the normalization step below.
"""

from __future__ import annotations

import argparse
import csv
import logging
import sys
from pathlib import Path
from typing import Iterable, Optional


# ---------------------------------------------------------------------------
# nflverse imports — uncomment exactly one when ready to leave stub mode.
# Both libraries pull from the same nflverse-data releases (no API keys).
# ---------------------------------------------------------------------------
#
# import nflreadpy as nfl         # Recommended: Polars-first, current.
# import nfl_data_py as nfl_dp    # Legacy: Pandas-based; still works.
#
# Function map used below:
#   schedules         -> nfl.load_schedules(seasons=[s])
#                        nfl_dp.import_schedules([s])
#   player week stats -> nfl.load_player_stats(seasons=[s])
#                        nfl_dp.import_weekly_data([s])
#   play-by-play      -> nfl.load_pbp(seasons=[s])
#                        nfl_dp.import_pbp_data([s])
#   snap counts       -> nfl.load_snap_counts(seasons=[s])
#                        nfl_dp.import_snap_counts([s])
#   players/IDs       -> nfl.load_players()
#                        nfl_dp.import_ids() / import_rosters([s])
#
# ---------------------------------------------------------------------------


LOG = logging.getLogger("ingest-nfl-history")


# ---------------------------------------------------------------------------
# Normalized output schemas.
#
# These column lists are the contract between this script and the Prisma
# loader. Changing them requires a paired Prisma migration. Keep IDs as
# strings so we can store nflverse ids (e.g. `00-0033873` for Mahomes)
# without losing leading zeros.
# ---------------------------------------------------------------------------

GAMES_COLUMNS = [
    "game_id",          # nflverse game_id, e.g. "2025_11_KC_BUF"
    "season",
    "season_type",      # REG | POST
    "week",
    "kickoff_utc",      # ISO-8601 UTC
    "home_team",        # team abbr (KC, BUF, ...)
    "away_team",
    "home_score",
    "away_score",
    "stadium",
    "roof",             # dome | outdoors | closed | open
    "surface",          # grass | fieldturf | ...
    "spread_line",      # closing spread for home team
    "total_line",
]

# Player-week stats restricted to V1 markets (passing/receiving/rushing
# volume). Touchdown columns are intentionally absent.
PLAYER_WEEK_STATS_COLUMNS = [
    "player_id",                # nflverse gsis_id
    "season",
    "week",
    "season_type",
    "team",                     # player's team abbr that week
    "opponent",                 # opponent abbr that week
    "position",                 # QB | RB | WR | TE | ...
    "passing_attempts",
    "passing_completions",
    "passing_yards",
    "receptions",
    "receiving_yards",
    "targets",
    "rushing_attempts",
    "rushing_yards",
    "snaps_offense",            # joined from snap_counts for convenience
]

# Team-week stats are derived from play-by-play. We pre-aggregate here so
# the model layer doesn't need Polars/Pandas just to know how pass-heavy
# a team has been.
TEAM_WEEK_STATS_COLUMNS = [
    "team",
    "season",
    "week",
    "season_type",
    "opponent",
    "plays_offense",
    "plays_defense",
    "pass_attempts_off",
    "pass_attempts_def",
    "rush_attempts_off",
    "rush_attempts_def",
    "passing_yards_off",
    "passing_yards_def",
    "rushing_yards_off",
    "rushing_yards_def",
    "seconds_per_play_off",
    "score_off",
    "score_def",
]

SNAP_COUNTS_COLUMNS = [
    "player_id",
    "season",
    "week",
    "season_type",
    "team",
    "opponent",
    "offense_snaps",
    "offense_pct",
    "defense_snaps",
    "defense_pct",
    "st_snaps",
    "st_pct",
]

PLAYER_IDS_COLUMNS = [
    "player_id",        # canonical id (nflverse gsis_id)
    "gsis_id",
    "esb_id",
    "nflverse_id",
    "pfr_id",
    "sleeper_id",
    "espn_id",
    "full_name",
    "first_name",
    "last_name",
    "position",
    "current_team",
    "birth_date",
    "jersey",
]


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------

def ensure_dirs(out_root: Path) -> tuple[Path, Path]:
    raw = out_root / "raw"
    processed = out_root / "processed"
    raw.mkdir(parents=True, exist_ok=True)
    processed.mkdir(parents=True, exist_ok=True)
    return raw, processed


def write_csv(path: Path, columns: list[str], rows: Iterable[dict]) -> int:
    n = 0
    with path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({col: row.get(col, "") for col in columns})
            n += 1
    return n


# ---------------------------------------------------------------------------
# Per-source pulls.
#
# Each function returns an iterable of dicts already mapped to the
# normalized column list above. For now every function is a stub that
# returns an empty iterable — running the script produces schema-only
# CSVs so the downstream loader can be built and tested against the
# expected shape.
#
# When wiring the real pulls, the only thing that changes inside each
# function is the body. The signature stays the same so callers don't
# need to care which library backs the call.
# ---------------------------------------------------------------------------

def pull_schedules(
    season: int, weeks: Optional[set[int]], raw_dir: Path
) -> Iterable[dict]:
    """
    Real implementation (sketch):

        df = nfl.load_schedules(seasons=[season])         # Polars / Pandas
        if weeks:
            df = df.filter(pl.col("week").is_in(list(weeks)))
        df.write_csv(raw_dir / f"schedules-{season}.csv")
        for row in df.iter_rows(named=True):
            yield {
                "game_id":     row["game_id"],
                "season":      row["season"],
                "season_type": row["season_type"],
                "week":        row["week"],
                "kickoff_utc": _to_utc(row["gameday"], row.get("gametime")),
                "home_team":   row["home_team"],
                "away_team":   row["away_team"],
                "home_score":  row.get("home_score"),
                "away_score":  row.get("away_score"),
                "stadium":     row.get("stadium"),
                "roof":        row.get("roof"),
                "surface":     row.get("surface"),
                "spread_line": row.get("spread_line"),
                "total_line":  row.get("total_line"),
            }
    """
    LOG.info("schedules: stub (would pull season=%s weeks=%s)", season, weeks)
    return iter(())


def pull_player_week_stats(
    season: int, weeks: Optional[set[int]], raw_dir: Path
) -> Iterable[dict]:
    """
    Real implementation (sketch):

        df = nfl.load_player_stats(seasons=[season])
        # Source columns of interest:
        #   player_id, season, week, season_type, recent_team, opponent_team,
        #   position, attempts, completions, passing_yards,
        #   receptions, receiving_yards, targets, carries, rushing_yards
        # (We drop *_tds and any TD columns — V1 doesn't trade TDs.)

        if weeks:
            df = df.filter(pl.col("week").is_in(list(weeks)))

        df.write_csv(raw_dir / f"player_stats-{season}.csv")

        for row in df.iter_rows(named=True):
            yield {
                "player_id":          row["player_id"],
                "season":             row["season"],
                "week":               row["week"],
                "season_type":        row["season_type"],
                "team":               row["recent_team"],
                "opponent":           row["opponent_team"],
                "position":           row.get("position"),
                "passing_attempts":   row.get("attempts", 0) or 0,
                "passing_completions":row.get("completions", 0) or 0,
                "passing_yards":      row.get("passing_yards", 0) or 0,
                "receptions":         row.get("receptions", 0) or 0,
                "receiving_yards":    row.get("receiving_yards", 0) or 0,
                "targets":            row.get("targets", 0) or 0,
                "rushing_attempts":   row.get("carries", 0) or 0,
                "rushing_yards":      row.get("rushing_yards", 0) or 0,
                "snaps_offense":      None,  # joined from snap_counts later
            }
    """
    LOG.info(
        "player_week_stats: stub (season=%s weeks=%s)", season, weeks,
    )
    return iter(())


def pull_team_week_stats(
    season: int, weeks: Optional[set[int]], raw_dir: Path
) -> Iterable[dict]:
    """
    Derived from PBP. The PBP frame is ~50k rows per week so we aggregate
    here and only persist the rolled-up totals.

    Real implementation (sketch):

        pbp = nfl.load_pbp(seasons=[season])
        pbp.write_parquet(raw_dir / f"pbp-{season}.parquet")  # parquet, not csv

        if weeks:
            pbp = pbp.filter(pl.col("week").is_in(list(weeks)))

        # Group by (posteam, season, week) for offense and (defteam, ...)
        # for defense, then join the two on the (team, season, week) key.
        # Yield one dict per (team, season, week) matching TEAM_WEEK_STATS_COLUMNS.
    """
    LOG.info("team_week_stats: stub (season=%s weeks=%s)", season, weeks)
    return iter(())


def pull_snap_counts(
    season: int, weeks: Optional[set[int]], raw_dir: Path
) -> Iterable[dict]:
    """
    Real implementation (sketch):

        df = nfl.load_snap_counts(seasons=[season])
        if weeks:
            df = df.filter(pl.col("week").is_in(list(weeks)))
        df.write_csv(raw_dir / f"snap_counts-{season}.csv")
        for row in df.iter_rows(named=True):
            yield {
                "player_id":     row["pfr_player_id"],  # NB: pfr id, may need a join to gsis
                "season":        row["season"],
                "week":          row["week"],
                "season_type":   row["game_type"],
                "team":          row["team"],
                "opponent":      row["opponent"],
                "offense_snaps": row.get("offense_snaps", 0) or 0,
                "offense_pct":   row.get("offense_pct", 0) or 0,
                "defense_snaps": row.get("defense_snaps", 0) or 0,
                "defense_pct":   row.get("defense_pct", 0) or 0,
                "st_snaps":      row.get("st_snaps", 0) or 0,
                "st_pct":        row.get("st_pct", 0) or 0,
            }
    """
    LOG.info("snap_counts: stub (season=%s weeks=%s)", season, weeks)
    return iter(())


def pull_player_ids(season: int, raw_dir: Path) -> Iterable[dict]:
    """
    Real implementation (sketch):

        players = nfl.load_players()                # canonical IDs + bio
        roster  = nfl.load_rosters(seasons=[season])  # current_team / jersey
        # Left-join on gsis_id, then yield one row per player matching
        # PLAYER_IDS_COLUMNS. Cross-id mapping (esb / pfr / sleeper / espn)
        # is the value-add of this file — every other table joins on
        # `player_id` and we resolve other IDs here.
    """
    LOG.info("player_ids: stub (season=%s)", season)
    return iter(())


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_weeks(spec: Optional[str]) -> Optional[set[int]]:
    if not spec:
        return None
    weeks: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            lo, hi = part.split("-", 1)
            weeks.update(range(int(lo), int(hi) + 1))
        else:
            weeks.add(int(part))
    return weeks


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Ingest NFL historical stats into normalized CSVs.",
    )
    parser.add_argument(
        "--season", type=int, required=True, help="NFL season year, e.g. 2025",
    )
    parser.add_argument(
        "--weeks",
        help="comma/dash-separated week filter, e.g. '1-10,12'. Default: all weeks.",
    )
    parser.add_argument(
        "--out",
        default="data",
        help="root directory for raw/ and processed/ (default: data)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip writes to disk and just log what would be pulled.",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    weeks = parse_weeks(args.weeks)
    out_root = Path(args.out).resolve()
    raw_dir, processed_dir = ensure_dirs(out_root)
    LOG.info("Season=%s weeks=%s", args.season, sorted(weeks) if weeks else "ALL")
    LOG.info("Output: raw=%s processed=%s", raw_dir, processed_dir)

    pulls = [
        ("games",             GAMES_COLUMNS,             pull_schedules(args.season, weeks, raw_dir)),
        ("player_week_stats", PLAYER_WEEK_STATS_COLUMNS, pull_player_week_stats(args.season, weeks, raw_dir)),
        ("team_week_stats",   TEAM_WEEK_STATS_COLUMNS,   pull_team_week_stats(args.season, weeks, raw_dir)),
        ("snap_counts",       SNAP_COUNTS_COLUMNS,       pull_snap_counts(args.season, weeks, raw_dir)),
        ("player_ids",        PLAYER_IDS_COLUMNS,        pull_player_ids(args.season, raw_dir)),
    ]

    if args.dry_run:
        for name, cols, _rows in pulls:
            LOG.info("[dry-run] would write %s (%d cols)", processed_dir / f"{name}.csv", len(cols))
        return 0

    for name, cols, rows in pulls:
        path = processed_dir / f"{name}.csv"
        n = write_csv(path, cols, rows)
        LOG.info("Wrote %s (%d data rows, %d cols)", path, n, len(cols))

    LOG.info("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
