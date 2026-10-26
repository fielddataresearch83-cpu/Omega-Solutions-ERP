import { Navigate } from "react-router-dom"

/**
 * The old template page used hard-coded sample users and browser-only edits.
 * Keep the legacy URL working, but route users to the live, tenant-scoped
 * membership and permissions screen instead.
 */
export default function UsersPage() {
  return <Navigate to="/users-roles" replace />
}
