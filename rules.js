// Free, no-AI location matching.
//
// Looks for place names and country flag emojis in a video's title and description.
// It is used when the creator hasn't tagged a location and either the Anthropic key
// isn't set or Claude is unavailable.
//
// How it chooses:
//   - Title first, then the first 300 characters of the description.
//   - A city, region or landmark beats a country ("Bali" beats "Indonesia"), and
//     the one that appears first in the text wins.
//   - A country name beats a flag emoji, and a flag is used if nothing else is found.

import { PLACES, ALIASES, FLAGS } from "./places.js";

// Lower-case, strip accents, and turn anything that isn't a letter or digit into a space.
export const normalise = (s) =>
  String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// name (as written in places.js) -> index
const byName = new Map(PLACES.map((p, i) => [p[0], i]));

// normalised spelling -> index into PLACES
const KEY_INDEX = new Map();
PLACES.forEach((p, i) => {
  const key = normalise(p[0]);
  if (key.length >= 3 && !KEY_INDEX.has(key)) KEY_INDEX.set(key, i);
});
for (const [alias, name] of Object.entries(ALIASES)) {
  const i = byName.get(name);
  if (i !== undefined && !KEY_INDEX.has(alias)) KEY_INDEX.set(alias, i);
}
const MAX_WORDS = Math.max(...[...KEY_INDEX.keys()].map((k) => k.split(" ").length));

function toLocation(index, confidence) {
  const [name, lat, lng] = PLACES[index];
  return { name, lat, lng, confidence, source: "keyword" };
}

// Reads left to right, always taking the longest place name that starts at each word,
// so "New York" is found as one place rather than "York".
function findPlaces(text, minKeyLength) {
  const words = normalise(text).split(" ").filter(Boolean);
  const found = [];
  for (let i = 0; i < words.length; i++) {
    for (let n = Math.min(MAX_WORDS, words.length - i); n >= 1; n--) {
      const key = words.slice(i, i + n).join(" ");
      const index = KEY_INDEX.get(key);
      if (index !== undefined && key.length >= minKeyLength) {
        found.push({ index, position: i });
        i += n - 1;
        break;
      }
    }
  }
  return found;
}

// Flag emojis are pairs of regional-indicator letters, e.g. 🇯🇵 = J + P.
function findFlags(text) {
  const found = [];
  for (const m of String(text).matchAll(/[\u{1F1E6}-\u{1F1FF}]{2}/gu)) {
    const code = [...m[0]].map((ch) => String.fromCharCode(ch.codePointAt(0) - 0x1f1e6 + 65)).join("");
    const index = byName.get(FLAGS[code]);
    if (index !== undefined) found.push({ index, position: m.index });
  }
  return found;
}

function pick(text, minKeyLength) {
  const places = findPlaces(text, minKeyLength);
  const specific = places.find((p) => PLACES[p.index][3] === 0); // earliest city/region/landmark
  if (specific) return specific.index;
  const country = places[0]; // only countries are left
  if (country) return country.index;
  const flag = findFlags(text)[0];
  return flag ? flag.index : undefined;
}

export function locateByRules(video) {
  const inTitle = pick(video.title || "", 0);
  if (inTitle !== undefined) return toLocation(inTitle, "medium");

  // In the description, ignore very short names: they are more often ordinary words.
  const inIntro = pick(String(video.description || "").slice(0, 300), 5);
  if (inIntro !== undefined) return toLocation(inIntro, "low");

  return null;
}
