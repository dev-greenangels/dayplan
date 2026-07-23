import { redirect } from 'next/navigation'

/** Org settings moved into team modals on /admin */
export default function OrgPageRedirect() {
  redirect('/admin')
}
