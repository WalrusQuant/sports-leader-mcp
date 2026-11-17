/**
 * get_game_preview weather regressions.
 * Gusts must not fill windMph, and conditionId labels follow the published
 * AccuWeather weather-icons table (codes 1–44, as ESPN uses them).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { conditionLabel, parseOutdoorWeather } from "./tools/preview.js";

/** Title case of the published icon text. "w/" is "with"; "T-storms" is "Thunderstorms". */
const PUBLISHED: Record<string, string> = {
  "1": "Sunny",
  "2": "Mostly Sunny",
  "3": "Partly Sunny",
  "4": "Intermittent Clouds",
  "5": "Hazy Sunshine",
  "6": "Mostly Cloudy",
  "7": "Cloudy",
  "8": "Dreary (Overcast)",
  "11": "Fog",
  "12": "Showers",
  "13": "Mostly Cloudy with Showers",
  "14": "Partly Sunny with Showers",
  "15": "Thunderstorms",
  "16": "Mostly Cloudy with Thunderstorms",
  "17": "Partly Sunny with Thunderstorms",
  "18": "Rain",
  "19": "Flurries",
  "20": "Mostly Cloudy with Flurries",
  "21": "Partly Sunny with Flurries",
  "22": "Snow",
  "23": "Mostly Cloudy with Snow",
  "24": "Ice",
  "25": "Sleet",
  "26": "Freezing Rain",
  "29": "Rain and Snow",
  "30": "Hot",
  "31": "Cold",
  "32": "Windy",
  "33": "Clear",
  "34": "Mostly Clear",
  "35": "Partly Cloudy",
  "36": "Intermittent Clouds",
  "37": "Hazy Moonlight",
  "38": "Mostly Cloudy",
  "39": "Partly Cloudy with Showers",
  "40": "Mostly Cloudy with Showers",
  "41": "Partly Cloudy with Thunderstorms",
  "42": "Mostly Cloudy with Thunderstorms",
  "43": "Mostly Cloudy with Flurries",
  "44": "Mostly Cloudy with Snow",
};

test("condition labels match the published AccuWeather icon table", () => {
  for (const [id, label] of Object.entries(PUBLISHED)) {
    assert.equal(conditionLabel(id), label, `code ${id}`);
    assert.equal(conditionLabel(Number(id)), label, `numeric code ${id}`);
  }
  assert.equal(conditionLabel(36), "Intermittent Clouds");
  assert.equal(conditionLabel(37), "Hazy Moonlight");
  assert.equal(conditionLabel(38), "Mostly Cloudy");
  for (const unused of [9, 10, 27, 28, 45, 0, "Hazy", "", null]) {
    assert.equal(conditionLabel(unused), null, `unused ${String(unused)}`);
  }
});

test("gust-only weather leaves windMph null", () => {
  // Current ESPN summaries: temperature, conditionId, gust, precipitation. No windSpeed.
  const weather = parseOutdoorWeather({
    temperature: 61,
    highTemperature: 61,
    conditionId: "6",
    gust: 17,
    precipitation: 2,
  });
  assert.deepEqual(weather, {
    tempF: 61,
    condition: "Mostly Cloudy",
    windMph: null,
    gustMph: 17,
    precipPct: 2,
  });
});

test("sustained wind and gust stay separate", () => {
  assert.deepEqual(
    parseOutdoorWeather({ temperature: 50, conditionId: 33, windSpeed: 8, gust: 17, precipitation: 0 }),
    { tempF: 50, condition: "Clear", windMph: 8, gustMph: 17, precipPct: 0 },
  );
  assert.deepEqual(
    parseOutdoorWeather({ wind: "NW 12 mph", gust: "25 mph", conditionId: "37" }),
    { tempF: null, condition: "Hazy Moonlight", windMph: 12, gustMph: 25, precipPct: null },
  );
  assert.deepEqual(
    parseOutdoorWeather({ wind: { speed: 9, direction: "SW" }, gust: 14, conditionId: "36" }),
    { tempF: null, condition: "Intermittent Clouds", windMph: 9, gustMph: 14, precipPct: null },
  );
  // Calm is a sustained speed. It is not missing, so the gust stays in gustMph.
  assert.deepEqual(parseOutdoorWeather({ windSpeed: 0, gust: 15, conditionId: "38" }), {
    tempF: null,
    condition: "Mostly Cloudy",
    windMph: 0,
    gustMph: 15,
    precipPct: null,
  });
  assert.equal(parseOutdoorWeather({ gust: 0, conditionId: "4" })?.windMph, null);
  assert.equal(parseOutdoorWeather({ gust: 0, conditionId: "4" })?.gustMph, 0);
});

test("a gust alone is still weather, and an empty document is not", () => {
  assert.deepEqual(parseOutdoorWeather({ gust: 12 }), {
    tempF: null,
    condition: null,
    windMph: null,
    gustMph: 12,
    precipPct: null,
  });
  assert.equal(parseOutdoorWeather({}), null);
  assert.equal(parseOutdoorWeather({ link: { text: "Weather" } }), null);
  assert.equal(parseOutdoorWeather(null), null);
  assert.equal(
    parseOutdoorWeather({ displayValue: "Weather", conditionId: "8" })?.condition,
    "Dreary (Overcast)",
  );
  assert.equal(parseOutdoorWeather({ displayValue: "Cloudy", conditionId: "1" })?.condition, "Cloudy");
});
