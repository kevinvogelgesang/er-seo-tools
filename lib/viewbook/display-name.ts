// Pure header display-name derivation (spec §7): the client-entered
// school-name answer wins over the internal CRM client record name whenever
// it's actually been filled in — otherwise fall back to clientName so the
// header never renders blank before pc-setup is answered.

export function viewbookDisplayName(input: {
  schoolNameValue: string | null
  clientName: string
}): string {
  const trimmed = input.schoolNameValue?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : input.clientName
}
