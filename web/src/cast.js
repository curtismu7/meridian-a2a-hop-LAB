// Shared persona/cast vocabulary (rule 10). Stories keep {{cast.person}}, {{cast.agent}} tokens; this fills them.
// Renaming the demo's people/nouns happens here only.
export const cast = {
  person: 'Jordan Ellis',
  personShort: 'Jordan',
  agent: 'Meridian concierge',
  specialistPayouts: 'Meridian payouts agent',
  specialistPayments: 'Meridian payments agent',
  brand: 'Meridian Pay',
  platform: 'Northbridge Agents', // the third-party platform the external agent comes from
}

export function fillCast(text) {
  return String(text).replace(/\{\{cast\.(\w+)\}\}/g, (_, k) => cast[k] ?? `{{cast.${k}}}`)
}
