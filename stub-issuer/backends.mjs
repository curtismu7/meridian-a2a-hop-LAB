// Mock MCP tool backends. Data lives in-process; Reset restores the seed.
export const SEED_PAYOUTS = [
  { payoutId: 'po_8821', state: 'COMPLETED', amount: 1840.22, currency: 'USD', account: 'Meridian **8821', date: '2026-10-19', reference: 'WP-ME-2026-10-19' },
  { payoutId: 'po_8814', state: 'EXECUTED', amount: 2185.10, currency: 'USD', account: 'Meridian **8821', date: '2026-10-16', reference: 'WP-ME-2026-10-16' },
  { payoutId: 'po_8809', state: 'COMPLETED', amount: 4539.15, currency: 'USD', account: 'Meridian **2043', date: '2026-10-11', reference: 'WP-ME-2026-10-11' },
  { payoutId: 'po_8796', state: 'COMPLETED', amount: 4539.35, currency: 'USD', account: 'Meridian **2043', date: '2026-10-04', reference: 'WP-ME-2026-10-04' },
  { payoutId: 'po_8781', state: 'COMPLETED', amount: 1180.44, currency: 'USD', account: 'Meridian **8821', date: '2026-10-01', reference: 'WP-ME-2026-10-01' },
]

export function createBackends() {
  let payouts = structuredClone(SEED_PAYOUTS)
  return {
    reset: () => {
      payouts = structuredClone(SEED_PAYOUTS)
    },
    queryAccountPayouts({ pageSize = 5 } = {}) {
      return payouts.slice(0, pageSize)
    },
    takeGuestPayment() {
      // Refusal bait: the door's policy refuses the call before this runs.
      throw new Error('take_guest_payment should never run in the demo')
    },
  }
}
