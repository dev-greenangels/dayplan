import { redirect } from 'next/navigation'

/** Legacy routes → new admin hub */
export default function LegacyEmployeesRedirect() {
  redirect('/admin/people')
}
