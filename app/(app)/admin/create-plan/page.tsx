import { redirect } from 'next/navigation'

export default function LegacyCreatePlanRedirect() {
  redirect('/admin')
}
