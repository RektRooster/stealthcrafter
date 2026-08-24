import type { Scenario } from "./sim";

// Scenarios are the questions the simulator answers. Each one is a real,
// documented European failure mode rather than an invented catastrophe.
export const SCENARIOS: Scenario[] = [
  {
    id: "winter-outage-72",
    label: "72-hour winter power cut",
    summary:
      "Storm brings the grid down for three days in February. No heating, no mains light, water still runs but you cannot boil on an electric hob.",
    hours: 72,
    tempC: 1,
    gridDown: true,
    mainsWaterDown: false,
    evacuation: false,
    exertion: 1,
    hazardHint: "ENTSOE",
  },
  {
    id: "water-out-7d",
    label: "7 days without mains water",
    summary:
      "Contamination or a main burst takes drinking water out for a week. Power stays on. Everything you drink, cook and wash with comes from what you hold or can treat.",
    hours: 168,
    tempC: 12,
    gridDown: false,
    mainsWaterDown: true,
    evacuation: false,
    exertion: 1,
  },
  {
    id: "evacuate-2h",
    label: "Evacuation, two hours' notice",
    summary:
      "Wildfire or flood. You have two hours to load what you can carry and go, and 48 hours before you can rely on anything being provided.",
    hours: 48,
    tempC: 14,
    gridDown: true,
    mainsWaterDown: true,
    evacuation: true,
    noticeHours: 2,
    exertion: 1.35,
    hazardHint: "EFFIS",
  },
  {
    id: "deep-freeze-5d",
    label: "Five-day deep freeze, grid down",
    summary:
      "A cold snap at −8°C with the grid down for five days. This is the scenario that kills people in Europe, and the one most kits quietly fail.",
    hours: 120,
    tempC: -8,
    gridDown: true,
    mainsWaterDown: false,
    evacuation: false,
    exertion: 1,
    hazardHint: "ENTSOE",
  },
  {
    id: "supply-14d",
    label: "14-day supply chain disruption",
    summary:
      "Shelves empty and stay empty for a fortnight. Utilities hold. Everything you eat comes from what is already in the house.",
    hours: 336,
    tempC: 10,
    gridDown: false,
    mainsWaterDown: false,
    evacuation: false,
    exertion: 1,
    hazardHint: "TRANSPORT",
  },
  {
    id: "quake-72",
    label: "Earthquake aftermath, 72 hours",
    summary:
      "Structural damage, utilities severed, roads unreliable. Shelter outdoors or in a damaged building for three days until services reach you.",
    hours: 72,
    tempC: 8,
    gridDown: true,
    mainsWaterDown: true,
    evacuation: false,
    exertion: 1.25,
    hazardHint: "EMSC",
  },
];

// The official national lists SC 02 and SC 03 researched. Overlaying them turns
// a subjective kit into a measurable one against a recognised authority.
export type OfficialList = {
  id: string;
  authority: string;
  country: string;
  items: { label: string; match: RegExp }[];
};

export const OFFICIAL_LISTS: OfficialList[] = [
  {
    id: "bbk-de",
    authority: "BBK (Germany)",
    country: "DE",
    items: [
      { label: "Two litres of drinking water per person per day", match: /water|canteen|bottle|aqua|jerrycan/i },
      { label: "Ten days of food that needs no cooking", match: /ration|food|meal|kcal|mre|epa/i },
      { label: "Battery or crank radio", match: /radio|crank|wind-?up/i },
      { label: "Torch and spare batteries", match: /torch|flashlight|headlamp|lantern|batter/i },
      { label: "First aid kit and personal medication", match: /first aid|ifak|bandage|dressing|medic/i },
      { label: "Candles and matches or lighter", match: /candle|match|lighter|ferro|firesteel/i },
      { label: "Camping stove and fuel", match: /stove|fuel|canister|esbit|trangia/i },
      { label: "Warm blankets or sleeping bag", match: /sleeping bag|blanket|bivvy|quilt/i },
      { label: "Documents in a waterproof folder", match: /document|folder|waterproof case|dry bag/i },
      { label: "Fire extinguisher or blanket", match: /extinguisher|fire blanket/i },
    ],
  },
  {
    id: "rcb-pl",
    authority: "RCB (Poland)",
    country: "PL",
    items: [
      { label: "Drinking water for three days", match: /water|canteen|bottle|aqua/i },
      { label: "Non-perishable food", match: /ration|food|meal|kcal/i },
      { label: "Torch with spare cells", match: /torch|flashlight|headlamp|lantern/i },
      { label: "Radio with independent power", match: /radio|crank|wind-?up/i },
      { label: "First aid kit", match: /first aid|ifak|bandage|dressing/i },
      { label: "Power bank", match: /power bank|power station|batter/i },
      { label: "Copies of identity documents", match: /document|folder|waterproof case/i },
      { label: "Cash in small denominations", match: /cash|barter|coin/i },
      { label: "Warm clothing and footwear", match: /jacket|fleece|base layer|socks|gloves|beanie/i },
      { label: "Hygiene supplies", match: /hygiene|soap|wipes|sanit|toilet/i },
    ],
  },
  {
    id: "msb-se",
    authority: "MSB (Sweden)",
    country: "SE",
    items: [
      { label: "Water and containers to store it", match: /water|canteen|bottle|jerrycan|container/i },
      { label: "Food that keeps and needs little water", match: /ration|food|meal|kcal/i },
      { label: "Alternative heat source", match: /stove|heater|fuel|candle|wood/i },
      { label: "Warm clothes, blankets, sleeping bag", match: /sleeping bag|blanket|jacket|fleece|bivvy/i },
      { label: "Battery radio or car radio", match: /radio|crank|wind-?up/i },
      { label: "Torches and candles", match: /torch|flashlight|headlamp|candle|lantern/i },
      { label: "First aid and prescription medicines", match: /first aid|ifak|bandage|dressing|medic/i },
      { label: "Camping stove and fuel", match: /stove|fuel|canister|esbit|trangia/i },
      { label: "Matches and lighters", match: /match|lighter|ferro|firesteel/i },
      { label: "Cash", match: /cash|barter|coin/i },
    ],
  },
  {
    id: "eu-72",
    authority: "EU 72-hour guidance",
    country: "EU",
    items: [
      { label: "72 hours of water", match: /water|canteen|bottle|aqua|jerrycan/i },
      { label: "72 hours of food", match: /ration|food|meal|kcal/i },
      { label: "Light source", match: /torch|flashlight|headlamp|lantern|candle/i },
      { label: "Means of receiving public warnings", match: /radio|crank|wind-?up/i },
      { label: "First aid provision", match: /first aid|ifak|bandage|dressing/i },
      { label: "Means to charge a phone", match: /power bank|power station|solar|charger/i },
      { label: "Warmth without mains power", match: /sleeping bag|blanket|bivvy|stove|fuel/i },
      { label: "Personal documents and cash", match: /document|cash|folder|waterproof case/i },
    ],
  },
];
