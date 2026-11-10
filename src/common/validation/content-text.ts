import sanitizeHtml from 'sanitize-html';
export function containsProhibitedWords(value: string) {
  const plain = sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return (plain.match(/[\p{L}\p{N}]+/gu) ?? []).some((word) =>
    ['idiota', 'imbecil', 'mierda', 'fuck', 'shit'].includes(word),
  );
}
export function plainContent(value: string) {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
    .replace(
      /&(amp|lt|gt|quot|apos|#39);/g,
      (_match: string, entity: string) =>
        ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" })[
          entity
        ]!,
    )
    .normalize('NFC')
    .trim();
}
