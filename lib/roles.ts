import type { UserRole } from '@/lib/types'

export function isBoss(role: UserRole) {
  return role === 'super_admin'
}

export function isDeputyOrBoss(role: UserRole) {
  return role === 'super_admin' || role === 'sub_admin'
}

export const ROLE_LABEL: Record<string, string> = {
  pending: 'Очікує',
  employee: 'Працівник',
  sub_admin: 'Заступник',
  super_admin: 'Шеф',
}
