'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'sub_admin')) {
    redirect('/dashboard')
  }
  return { supabase, user }
}

export async function inviteEmployee(formData: FormData) {
  const { supabase } = await requireAdmin()

  const email = (formData.get('email') as string)?.trim()
  const full_name = (formData.get('full_name') as string)?.trim()
  const role = (formData.get('role') as string) || 'employee'
  const department = (formData.get('department') as string)?.trim()

  if (!email) return { error: 'Email є обовʼязковим' }

  // Invite user via Supabase (sends magic link)
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { full_name, role, department },
  })

  if (error) return { error: error.message }

  // Also upsert profile (in case trigger doesn't fire yet)
  if (data.user) {
    await supabase.from('profiles').upsert({
      id: data.user.id,
      full_name: full_name ?? '',
      email: email,
      role,
      department: department ?? '',
    }, { onConflict: 'id' })
  }

  return { success: true }
}

export async function updateEmployeeRole(profileId: string, role: string) {
  const { supabase } = await requireAdmin()
  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', profileId)
  if (error) return { error: error.message }
  return { success: true }
}

export async function createDayPlan(formData: FormData) {
  const { supabase, user } = await requireAdmin()

  const plan_date = formData.get('plan_date') as string
  const department = (formData.get('department') as string)?.trim()

  if (!plan_date || !department) return { error: 'Заповніть усі поля' }

  const { data: plan, error: planError } = await supabase
    .from('day_plans')
    .insert({ plan_date, department, created_by: user.id })
    .select()
    .single()

  if (planError) return { error: planError.message }

  // Add task rows for each selected employee
  const employeeIds = formData.getAll('employee_ids') as string[]
  const shift = (formData.get('default_shift') as string) || '8:00-17:00'

  if (employeeIds.length > 0) {
    const { error: rowsError } = await supabase.from('task_rows').insert(
      employeeIds.map(emp_id => ({
        plan_id: plan.id,
        employee_id: emp_id,
        shift,
      }))
    )
    if (rowsError) return { error: rowsError.message }
  }

  redirect(`/plans/${plan.id}`)
}

export async function addTaskRowToPlan(planId: string, employeeId: string, shift: string) {
  const { supabase } = await requireAdmin()
  const { error } = await supabase.from('task_rows').insert({
    plan_id: planId,
    employee_id: employeeId,
    shift: shift || '8:00-17:00',
  })
  if (error) return { error: error.message }
  return { success: true }
}
