/**
 * Backtest data loader.
 *
 * Only reads stored / fixture data. Never makes network calls. Live
 * ingestion (Odds API, nflverse, Open-Meteo, Kalshi) populates
 * `data/processed/` out-of-band; the backtest engine then reads it.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  BacktestGame,
  BacktestInjuryFlag,
  BacktestPlayerWeekStat,
  BacktestPropMarket,
  BacktestPropQuote,
  BacktestWeatherSnapshot,
} from "./types";

const FIXTURE_ROOT = "data/fixtures/backtest";
const PROCESSED_ROOT = "data/processed";

function readJson<T>(absPath: string): T {
  return JSON.parse(fs.readFileSync(absPath, "utf8")) as T;
}

export function loadFixtureGames(root = FIXTURE_ROOT): BacktestGame[] {
  return readJson<BacktestGame[]>(path.join(root, "games.fixture.json"));
}

export function loadFixturePlayerWeekStats(
  root = FIXTURE_ROOT,
): BacktestPlayerWeekStat[] {
  return readJson<BacktestPlayerWeekStat[]>(
    path.join(root, "player-week-stats.fixture.json"),
  );
}

export function loadFixturePropMarkets(
  root = FIXTURE_ROOT,
): BacktestPropMarket[] {
  return readJson<BacktestPropMarket[]>(
    path.join(root, "prop-markets.fixture.json"),
  );
}

export function loadFixturePropQuotes(
  root = FIXTURE_ROOT,
): BacktestPropQuote[] {
  return readJson<BacktestPropQuote[]>(
    path.join(root, "prop-quotes.fixture.json"),
  );
}

export function loadFixtureWeather(
  root = FIXTURE_ROOT,
): BacktestWeatherSnapshot[] {
  return readJson<BacktestWeatherSnapshot[]>(
    path.join(root, "weather.fixture.json"),
  );
}

export function loadFixtureInjuryFlags(
  root = FIXTURE_ROOT,
): BacktestInjuryFlag[] {
  return readJson<BacktestInjuryFlag[]>(
    path.join(root, "injury-flags.fixture.json"),
  );
}

export interface LoadedBacktestFixtures {
  games: BacktestGame[];
  playerWeekStats: BacktestPlayerWeekStat[];
  propMarkets: BacktestPropMarket[];
  propQuotes: BacktestPropQuote[];
  weather: BacktestWeatherSnapshot[];
  injuryFlags: BacktestInjuryFlag[];
}

export function loadBacktestFixtures(
  root = FIXTURE_ROOT,
): LoadedBacktestFixtures {
  return {
    games: loadFixtureGames(root),
    playerWeekStats: loadFixturePlayerWeekStats(root),
    propMarkets: loadFixturePropMarkets(root),
    propQuotes: loadFixturePropQuotes(root),
    weather: loadFixtureWeather(root),
    injuryFlags: loadFixtureInjuryFlags(root),
  };
}

/**
 * Stub for processed-data loading.
 *
 * Once the staged paid-API ingestion path populates `data/processed/`
 * (see `scripts/ingest-historical-prop-lines.ts`), this function will:
 *   - read prop_markets.csv + prop_quotes.csv produced by the ingestor
 *   - read player_week_stats.csv produced by the nflverse stub
 *   - read weather snapshots and injury flags from their respective
 *     normalized CSVs
 *   - return the same `LoadedBacktestFixtures` shape
 *
 * For now it throws — the runner falls back to fixtures.
 */
export function loadProcessedBacktestData(
  _root = PROCESSED_ROOT,
): LoadedBacktestFixtures {
  // TODO: wire CSV → BacktestPropMarket[] / BacktestPropQuote[] /
  //       BacktestPlayerWeekStat[] mappers once the ingestion pipeline
  //       has been run end-to-end against real 2025 data.
  throw new Error(
    "loadProcessedBacktestData is not wired yet — run the ingestion " +
      "pipeline first, then map CSVs into Backtest* types here.",
  );
}
