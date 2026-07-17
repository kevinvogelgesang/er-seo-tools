// Pure CSM-chip resolver for ProgressNav v2 (spec §8 matured header).
// Client-safe — no server imports.
import type { TeamMember } from './global-content-keys'

export interface CsmChip {
  name: string
  role: string
  photo: string | null
  email: string | null
}

export function resolveCsmChip(
  team: TeamMember[] | null | undefined,
  csmName: string | null,
): CsmChip | null {
  if (!team || !csmName) return null
  const match = team.find((m) => m.isCsm === true && m.name === csmName)
  if (!match) return null
  return {
    name: match.name,
    role: match.role,
    photo: match.photo,
    email: match.email ?? null,
  }
}
