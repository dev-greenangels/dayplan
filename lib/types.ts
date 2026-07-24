export type UserRole = 'pending' | 'employee' | 'sub_admin' | 'super_admin'
export type WorkMode = 'shared' | 'individual'

export interface Profile {
  id: string
  full_name: string
  email: string
  role: UserRole
  /** @deprecated use team_members; kept for legacy rows */
  department: string
  created_at: string
  invite_sent_at?: string | null
  invite_blocked?: boolean
  last_sign_in_at?: string | null
}

export interface Team {
  id: string
  name: string
  work_mode: WorkMode
  created_at: string
  default_shift?: string
  show_send_worker_emails?: boolean
  show_send_leadership?: boolean
}

export interface Department {
  id: string
  team_id: string
  name: string
  sort_order: number
  archived_at: string | null
  created_at: string
}

export interface TeamMember {
  team_id: string
  user_id: string
  department_id: string | null
  profile?: Profile
  department?: Department | null
}

export interface TeamColumn {
  id: string
  team_id: string
  key: string
  label: string
  sort_order: number
  is_system: boolean
  hidden: boolean
  created_at: string
}

export interface DayPlan {
  id: string
  plan_date: string
  team_id: string
  department?: string
  created_by: string | null
  created_at: string
  digest_sent_at?: string | null
  /** Per-leader channel stamps: { [userId]: { email?: iso, push?: iso } } */
  digest_receipts?: Record<string, { email?: string; push?: string }>
  team?: Team
}

export interface TaskRow {
  id: string
  plan_id: string
  employee_id: string
  department_id: string | null
  shift: string
  planned: string
  notified: boolean
  completed: string
  notes: string
  notify_email: boolean
  notify_push: boolean
  plan_email_sent_at?: string | null
  plan_push_sent_at?: string | null
  /** When employee sent «Звіт керівництву» for this row/day */
  report_sent_at?: string | null
  extra: Record<string, string>
  created_at: string
  profile?: Profile
  department?: Department | null
}

export interface DayPlanWithRows extends DayPlan {
  task_rows: (TaskRow & { profile: Profile })[]
}
