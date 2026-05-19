/**
 * Open-Meteo — historical weather ingestion client.
 *
 * Open-Meteo's archive API serves hourly historical weather worldwide
 * with no API key and no rate-limit auth. We use it to grab a single
 * pregame weather snapshot per outdoor NFL game.
 *
 * Endpoint:
 *   https://archive-api.open-meteo.com/v1/archive
 *
 * V1 uses US units (Fahrenheit, mph, inches) and timezone=UTC so the
 * returned hourly grid lines up directly with each game's kickoff UTC.
 */

// --- constants --------------------------------------------------------

export const OPEN_METEO_BASE_URL =
  process.env.OPEN_METEO_BASE_URL ??
  "https://archive-api.open-meteo.com/v1/archive";

/** Hourly variables we always request from Open-Meteo. */
export const HOURLY_VARS = [
  "temperature_2m",
  "wind_speed_10m",
  "wind_gusts_10m",
  "precipitation",
  "snowfall",
  "weather_code",
] as const;

export type HourlyVar = (typeof HOURLY_VARS)[number];

// --- domain types -----------------------------------------------------

export type RoofType = "outdoor" | "dome" | "retractable";

export interface Stadium {
  stadiumName: string;
  team: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  roofType: RoofType;
  surface: string;
}

export interface NormalizedWeatherSnapshot {
  gameId: string;
  team: string;
  stadiumName: string;
  roofType: RoofType;
  kickoffUtc: string;
  snapshotUtc: string;
  weatherImpactEligible: boolean;
  temperature: number | null;
  windSpeed: number | null;
  windGust: number | null;
  precipitation: number | null;
  snowfall: number | null;
  weatherCode: number | null;
}

// --- Open-Meteo response shape ----------------------------------------

export interface OpenMeteoHourlyUnits {
  time: string;
  temperature_2m?: string;
  wind_speed_10m?: string;
  wind_gusts_10m?: string;
  precipitation?: string;
  snowfall?: string;
  weather_code?: string;
}

export interface OpenMeteoHourly {
  time: string[];
  temperature_2m?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  wind_gusts_10m?: (number | null)[];
  precipitation?: (number | null)[];
  snowfall?: (number | null)[];
  weather_code?: (number | null)[];
}

export interface OpenMeteoArchiveResponse {
  latitude: number;
  longitude: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  elevation: number;
  hourly_units?: OpenMeteoHourlyUnits;
  hourly?: OpenMeteoHourly;
}

// --- eligibility ------------------------------------------------------

/**
 * A game is weather-impact-eligible if the home stadium roof is open at
 * kickoff. We don't have per-game retractable roof state yet, so:
 *   - dome           -> false (always indoors)
 *   - outdoor        -> true
 *   - retractable    -> true (default; many teams keep the roof open
 *                       in mild weather. Override per-game when we
 *                       wire in the actual `roof_state` from PBP.)
 */
export function isWeatherImpactEligible(roofType: RoofType): boolean {
  switch (roofType) {
    case "dome":
      return false;
    case "outdoor":
    case "retractable":
      return true;
  }
}

// --- URL builder + fetcher --------------------------------------------

export interface ArchiveUrlArgs {
  latitude: number;
  longitude: number;
  /** YYYY-MM-DD; archive API takes a date range (one day is fine). */
  startDate: string;
  endDate: string;
  hourly?: readonly HourlyVar[];
  timezone?: string;
  temperatureUnit?: "fahrenheit" | "celsius";
  windSpeedUnit?: "mph" | "kmh" | "ms" | "kn";
  precipitationUnit?: "inch" | "mm";
}

export function buildArchiveUrl(args: ArchiveUrlArgs): string {
  const u = new URL(OPEN_METEO_BASE_URL);
  u.searchParams.set("latitude", String(args.latitude));
  u.searchParams.set("longitude", String(args.longitude));
  u.searchParams.set("start_date", args.startDate);
  u.searchParams.set("end_date", args.endDate);
  u.searchParams.set("hourly", (args.hourly ?? HOURLY_VARS).join(","));
  u.searchParams.set("timezone", args.timezone ?? "UTC");
  u.searchParams.set("temperature_unit", args.temperatureUnit ?? "fahrenheit");
  u.searchParams.set("wind_speed_unit", args.windSpeedUnit ?? "mph");
  u.searchParams.set("precipitation_unit", args.precipitationUnit ?? "inch");
  return u.toString();
}

class OpenMeteoError extends Error {
  constructor(message: string, public status: number, public body: string) {
    super(message);
    this.name = "OpenMeteoError";
  }
}

export async function fetchArchive(
  args: ArchiveUrlArgs,
): Promise<OpenMeteoArchiveResponse> {
  const url = buildArchiveUrl(args);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OpenMeteoError(
      `Open-Meteo ${res.status} ${res.statusText} on ${url}`,
      res.status,
      body,
    );
  }
  return (await res.json()) as OpenMeteoArchiveResponse;
}

// --- snapshot picking --------------------------------------------------

/** Return the index in the hourly time array closest to `targetISO`. */
export function pickHourIndex(times: string[], targetISO: string): number {
  if (times.length === 0) return -1;
  const target = new Date(targetISO).getTime();
  let bestIdx = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < times.length; i++) {
    // Open-Meteo returns "YYYY-MM-DDTHH:mm" without trailing Z when
    // timezone=UTC; normalize so Date parses it as UTC.
    const t = times[i].endsWith("Z") ? times[i] : `${times[i]}:00Z`.replace(":00:00Z", ":00Z");
    const delta = Math.abs(new Date(t).getTime() - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Normalize an Open-Meteo response into a single snapshot row at the
 * hour closest to `kickoffISO`. Caller provides game / stadium context.
 */
export function normalizeWeatherSnapshot(
  response: OpenMeteoArchiveResponse,
  ctx: {
    gameId: string;
    kickoffISO: string;
    stadium: Stadium;
  },
): NormalizedWeatherSnapshot {
  const hourly = response.hourly;
  const times = hourly?.time ?? [];
  const idx = pickHourIndex(times, ctx.kickoffISO);
  const snapshotTime =
    idx >= 0 && times[idx]
      ? normalizeIsoUtc(times[idx])
      : ctx.kickoffISO;

  const get = (arr: (number | null)[] | undefined): number | null => {
    if (!arr || idx < 0) return null;
    const v = arr[idx];
    return typeof v === "number" ? v : null;
  };

  return {
    gameId: ctx.gameId,
    team: ctx.stadium.team,
    stadiumName: ctx.stadium.stadiumName,
    roofType: ctx.stadium.roofType,
    kickoffUtc: ctx.kickoffISO,
    snapshotUtc: snapshotTime,
    weatherImpactEligible: isWeatherImpactEligible(ctx.stadium.roofType),
    temperature: get(hourly?.temperature_2m),
    windSpeed: get(hourly?.wind_speed_10m),
    windGust: get(hourly?.wind_gusts_10m),
    precipitation: get(hourly?.precipitation),
    snowfall: get(hourly?.snowfall),
    weatherCode: get(hourly?.weather_code),
  };
}

/**
 * For domes / closed roofs we still emit a row so downstream joins
 * are total, but with null weather values and eligibility=false.
 */
export function buildIneligibleSnapshot(ctx: {
  gameId: string;
  kickoffISO: string;
  stadium: Stadium;
}): NormalizedWeatherSnapshot {
  return {
    gameId: ctx.gameId,
    team: ctx.stadium.team,
    stadiumName: ctx.stadium.stadiumName,
    roofType: ctx.stadium.roofType,
    kickoffUtc: ctx.kickoffISO,
    snapshotUtc: ctx.kickoffISO,
    weatherImpactEligible: false,
    temperature: null,
    windSpeed: null,
    windGust: null,
    precipitation: null,
    snowfall: null,
    weatherCode: null,
  };
}

// --- helpers ----------------------------------------------------------

/** Format a Date as `YYYY-MM-DD` in UTC — what the archive API expects. */
export function utcDateString(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

function normalizeIsoUtc(s: string): string {
  // Open-Meteo with timezone=UTC returns "YYYY-MM-DDTHH:mm". Add ":00Z".
  if (s.endsWith("Z")) return s;
  if (s.length === 16) return `${s}:00Z`;
  return s;
}

/**
 * WMO weather code reference (for future severity scoring):
 *   0           clear sky
 *   1,2,3       mainly clear / partly cloudy / overcast
 *   45,48       fog / depositing rime fog
 *   51,53,55    drizzle (light / moderate / dense)
 *   56,57       freezing drizzle
 *   61,63,65    rain (slight / moderate / heavy)
 *   66,67       freezing rain
 *   71,73,75    snowfall (slight / moderate / heavy)
 *   77          snow grains
 *   80,81,82    rain showers
 *   85,86       snow showers
 *   95          thunderstorm
 *   96,99       thunderstorm with hail
 */
export const WMO_CODE_NOTE = "see weather.ts source for WMO code reference";
