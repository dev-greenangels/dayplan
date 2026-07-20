export type UserRole = 'super_admin' | 'sub_admin' | 'employee'

export interface Profile {
  id: string
  full_name: string
  email: string
  role: UserRole
  department: string
  created_at: string
}

export interface DayPlan {
  id: string
  plan_date: string
  department: string
  created_by: string | null
  created_at: string
}

export interface TaskRow {
  id: string
  plan_id: string
  employee_id: string
  shift: string
  planned: string
  notified: boolean
  completed: string
  notes: string
  created_at: string
  // joined fields
  profile?: Profile
}

export interface DayPlanWithRows extends DayPlan {
  task_rows: (TaskRow & { profile: Profile })[]
}
