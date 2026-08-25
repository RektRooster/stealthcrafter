// Natural Earth numeric country id → ISO-3166-1 alpha-2.
//
// Kept in its own module because two very different consumers need it and
// neither should drag the other's topology in: lib/euro-map.ts builds the
// server-side 50m geometry (point-in-country attribution), lib/euro-geo.ts
// builds the light 110m outlines that ship to the browser over the satellite
// basemap.

/** EU-27 — the markets we operate in. */
export const EU27_IDS: Record<string, string> = {
  "040": "AT", "056": "BE", "100": "BG", "191": "HR", "196": "CY",
  "203": "CZ", "208": "DK", "233": "EE", "246": "FI", "250": "FR",
  "276": "DE", "300": "GR", "348": "HU", "372": "IE", "380": "IT",
  "428": "LV", "440": "LT", "442": "LU", "470": "MT", "528": "NL",
  "616": "PL", "620": "PT", "642": "RO", "703": "SK", "705": "SI",
  "724": "ES", "752": "SE",
};

/** Everything else that shares the continent. Hazards inside them still count:
    a fire in Ukraine or a quake in Turkey matters to a household in Poland. */
export const NEIGHBOUR_IDS: Record<string, string> = {
  "826": "GB", "578": "NO", "756": "CH", "352": "IS", "804": "UA",
  "688": "RS", "070": "BA", "008": "AL", "807": "MK", "499": "ME",
  "498": "MD", "112": "BY", "792": "TR", "643": "RU", "438": "LI",
  "020": "AD", "492": "MC", "674": "SM", "336": "VA", "292": "GI",
  "031": "AZ", "051": "AM", "268": "GE", "012": "DZ", "504": "MA",
  "788": "TN", "434": "LY", "818": "EG", "760": "SY", "422": "LB",
  "376": "IL", "400": "JO", "368": "IQ", "398": "KZ",
  "234": "FO", "833": "IM", "832": "JE", "831": "GG",
};

/** Kosovo carries no stable numeric id in Natural Earth — match on name. */
export const BY_NAME_IDS: Record<string, string> = { Kosovo: "XK" };

export const EU27_ISO2 = Object.values(EU27_IDS);

/** Human names for the countries we surface. Natural Earth's own `name`
    property is used when it is present; this fills the gaps and normalises
    the few it spells differently from the rest of the site. */
export const COUNTRY_NAMES: Record<string, string> = {
  AT: "Austria", BE: "Belgium", BG: "Bulgaria", HR: "Croatia", CY: "Cyprus",
  CZ: "Czechia", DK: "Denmark", EE: "Estonia", FI: "Finland", FR: "France",
  DE: "Germany", GR: "Greece", HU: "Hungary", IE: "Ireland", IT: "Italy",
  LV: "Latvia", LT: "Lithuania", LU: "Luxembourg", MT: "Malta", NL: "Netherlands",
  PL: "Poland", PT: "Portugal", RO: "Romania", SK: "Slovakia", SI: "Slovenia",
  ES: "Spain", SE: "Sweden", GB: "United Kingdom", NO: "Norway", CH: "Switzerland",
  IS: "Iceland", UA: "Ukraine", RS: "Serbia", BA: "Bosnia and Herzegovina",
  AL: "Albania", MK: "North Macedonia", ME: "Montenegro", MD: "Moldova",
  BY: "Belarus", TR: "Türkiye", RU: "Russia", XK: "Kosovo", DZ: "Algeria",
  MA: "Morocco", TN: "Tunisia", LY: "Libya", EG: "Egypt", KZ: "Kazakhstan",
  GE: "Georgia", AM: "Armenia", AZ: "Azerbaijan", SY: "Syria", LB: "Lebanon",
  IL: "Israel", JO: "Jordan", IQ: "Iraq",
};

export function countryName(iso2: string | null): string {
  if (!iso2) return "";
  return COUNTRY_NAMES[iso2] || iso2;
}
