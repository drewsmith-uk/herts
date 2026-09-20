// Match Hermes' title cleanup while preserving Unicode characters such as emoji.
export function cleanConversationTitle(text: string) {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff\ufffc\ufff9-\ufffb]/g, '')
    .replace(/[\ud800-\udfff]/gu, '').replace(/\s+/g, ' ').trim();
}
