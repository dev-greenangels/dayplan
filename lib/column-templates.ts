/** Default template for system «Обробки» (notes) column. */
export const NOTES_DEFAULT_TEMPLATE =
  'обробка від шкідників та хвороб:\nстрижка:\nвнесення добрив:'

export function normalizeTemplateText(value: string | null | undefined): string {
  return (value ?? '').replace(/\r\n/g, '\n').trim()
}

/** True when the cell has real content beyond an empty/template placeholder. */
export function isFilledBeyondTemplate(
  value: string | null | undefined,
  template: string | null | undefined
): boolean {
  const v = normalizeTemplateText(value)
  if (!v) return false
  const t = normalizeTemplateText(template)
  if (!t) return true
  return v !== t
}

/** Use template when the field is empty; keep existing non-empty values. */
export function applyInputTemplate(
  value: string | null | undefined,
  template: string | null | undefined
): string {
  const v = value ?? ''
  if (normalizeTemplateText(v)) return v
  return template ?? ''
}
