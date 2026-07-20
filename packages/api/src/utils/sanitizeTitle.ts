/** Max character length for sanitized titles (the output will never exceed this). */
export const MAX_TITLE_LENGTH = 200;
export const DEFAULT_TITLE_FALLBACK = '未命名对话';

/**
 * Sanitizes LLM-generated chat titles by removing {@link https://en.wikipedia.org/wiki/Chain-of-thought_prompting <think>}
 * and `<thinking>` reasoning blocks, normalizing whitespace, and truncating to
 * {@link MAX_TITLE_LENGTH} characters.
 *
 * Titles exceeding the limit are truncated at a code-point-safe boundary and suffixed with `...`.
 *
 * @param rawTitle - The raw LLM-generated title string, potentially containing reasoning blocks.
 * @returns A sanitized, potentially truncated title string, never empty (fallback used if needed).
 */
export function sanitizeTitle(rawTitle: string): string {
  if (!rawTitle || typeof rawTitle !== 'string') {
    return DEFAULT_TITLE_FALLBACK;
  }

  const reasoningBlockRegex = /<(think(?:ing)?)\b[^>]*>[\s\S]*?<\/\1>/gi;
  const cleaned = rawTitle.replace(reasoningBlockRegex, '');
  const normalized = cleaned.replace(/\s+/g, ' ');
  const trimmed = normalized.trim();

  if (trimmed.length === 0) {
    return DEFAULT_TITLE_FALLBACK;
  }

  const codePoints = [...trimmed];
  if (codePoints.length > MAX_TITLE_LENGTH) {
    const truncateAt = MAX_TITLE_LENGTH - 3;
    return codePoints.slice(0, truncateAt).join('').trimEnd() + '...';
  }

  return trimmed;
}
