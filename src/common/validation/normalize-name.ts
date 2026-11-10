import sanitizeHtml from 'sanitize-html';

/** Normalize before DTO length checks; never coerce objects or numbers to text. */
export function normalizeName(value: unknown): unknown {
  return typeof value === 'string'
    ? sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
        .normalize('NFC')
        .trim()
        .replace(/\s+/gu, ' ')
    : value;
}

export function normalizeSearch(value: unknown): unknown {
  return typeof value === 'string' ? value.normalize('NFC').trim() : value;
}
