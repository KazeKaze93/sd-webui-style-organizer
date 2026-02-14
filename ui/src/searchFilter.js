import { escapeRegex } from "./constants";

/**
 * Parse search query: phrases "", words, @CATEGORY, -exclude.
 * Returns { phraseTokens, wordTokens, catFilter, negTokens }.
 */
export function parseSearchQuery(raw) {
  const phraseTokens = [];
  const catFilter = [];
  const negTokens = [];
  const wordTokens = [];

  const remaining = (raw || "")
    .replace(/"([^"]*)"/g, (_, p1) => {
      const phrase = p1.trim().toLowerCase();
      if (phrase) phraseTokens.push(phrase);
      return " ";
    })
    .trim();

  remaining.split(/\s+/).forEach((token) => {
    if (!token) return;
    if (token.startsWith("@")) {
      const cat = token.slice(1).toUpperCase();
      if (cat) catFilter.push(cat);
    } else if (token.startsWith("-") && token.length > 1) {
      negTokens.push(token.slice(1).toLowerCase());
    } else {
      wordTokens.push(token.toLowerCase());
    }
  });

  return { phraseTokens, wordTokens, catFilter, negTokens };
}

export function cardMatchesSearch(searchData, category, { phraseTokens, wordTokens, catFilter, negTokens }) {
  const data = (searchData || "").toLowerCase();

  if (catFilter.length > 0 && !catFilter.includes(category)) return false;
  for (const neg of negTokens) {
    try {
      if (new RegExp("\\b" + escapeRegex(neg), "i").test(data)) return false;
    } catch {
      if (data.includes(neg)) return false;
    }
  }
  for (const phrase of phraseTokens) {
    if (!data.includes(phrase)) return false;
  }
  for (const word of wordTokens) {
    try {
      if (!new RegExp("\\b" + escapeRegex(word), "i").test(data)) return false;
    } catch {
      if (!data.includes(word)) return false;
    }
  }
  return true;
}

export function buildSearchData(style) {
  return (
    style.name +
    " " +
    style.display_name +
    " " +
    (style.prompt || "") +
    " " +
    (style.negative_prompt || "")
  )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
