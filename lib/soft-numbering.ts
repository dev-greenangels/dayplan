const LINE_PREFIX = /^(\d+)\.\s/

/** Next `N. ` from max existing numbered line, or `1. ` if none. */
export function nextNumberPrefix(text: string): string {
  let max = 0
  for (const line of text.split('\n')) {
    const m = line.match(LINE_PREFIX)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${max + 1}. `
}

/** If cell is empty on focus, return starter prefix; otherwise null (leave as-is). */
export function ensureEmptyFocusPrefix(text: string): string | null {
  if (text.trim() === '') return '1. '
  return null
}

/**
 * Soft Enter: insert newline + next ordinal at caret.
 * Caller should preventDefault when this returns a result.
 */
export function applyEnterNumbering(
  text: string,
  selectionStart: number,
  selectionEnd: number = selectionStart
): { text: string; caret: number } {
  const before = text.slice(0, selectionStart)
  const after = text.slice(selectionEnd)
  const prefix = nextNumberPrefix(text)
  const next = `${before}\n${prefix}${after}`
  return { text: next, caret: before.length + 1 + prefix.length }
}
