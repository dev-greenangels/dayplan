/** Extract Google/OAuth picture from Auth user_metadata. */
export function avatarFromMetadata(meta: Record<string, unknown> | undefined | null): string | null {
  if (!meta) return null
  const raw = meta.avatar_url ?? meta.picture ?? meta.avatar
  return typeof raw === 'string' && raw.startsWith('http') ? raw : null
}
