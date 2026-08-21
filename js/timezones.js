// ════════════════════════════════════════════════════════════
//  timezones.js: where people are in time, and how many core hours a
//  group shares. A person's zone comes from `tz:` (an IANA name or a
//  numeric offset) or, failing that, from the words in `location:` via a
//  small table of countries and cities. Offsets are computed with Intl so
//  daylight saving is right for today. Core hours are 09:00 to 17:00 local.
// ════════════════════════════════════════════════════════════

const ZONES = {
  // Americas
  'chile': 'America/Santiago', 'santiago': 'America/Santiago', 'argentina': 'America/Argentina/Buenos_Aires', 'buenos aires': 'America/Argentina/Buenos_Aires',
  'brazil': 'America/Sao_Paulo', 'brasil': 'America/Sao_Paulo', 'sao paulo': 'America/Sao_Paulo', 'colombia': 'America/Bogota', 'bogota': 'America/Bogota',
  'peru': 'America/Lima', 'lima': 'America/Lima', 'mexico': 'America/Mexico_City', 'mexico city': 'America/Mexico_City', 'cdmx': 'America/Mexico_City',
  'uruguay': 'America/Montevideo', 'ecuador': 'America/Guayaquil', 'venezuela': 'America/Caracas', 'costa rica': 'America/Costa_Rica', 'panama': 'America/Panama', 'guatemala': 'America/Guatemala',
  'usa': 'America/New_York', 'us': 'America/New_York', 'united states': 'America/New_York', 'new york': 'America/New_York', 'nyc': 'America/New_York', 'boston': 'America/New_York', 'miami': 'America/New_York', 'atlanta': 'America/New_York', 'tennessee': 'America/Chicago', 'dc': 'America/New_York',
  'chicago': 'America/Chicago', 'austin': 'America/Chicago', 'texas': 'America/Chicago', 'dallas': 'America/Chicago', 'houston': 'America/Chicago', 'minneapolis': 'America/Chicago',
  'denver': 'America/Denver', 'colorado': 'America/Denver', 'phoenix': 'America/Phoenix', 'arizona': 'America/Phoenix',
  'seattle': 'America/Los_Angeles', 'portland': 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', 'sf': 'America/Los_Angeles', 'los angeles': 'America/Los_Angeles', 'la': 'America/Los_Angeles', 'california': 'America/Los_Angeles', 'bay area': 'America/Los_Angeles',
  'canada': 'America/Toronto', 'toronto': 'America/Toronto', 'montreal': 'America/Toronto', 'ottawa': 'America/Toronto', 'vancouver': 'America/Vancouver', 'bc': 'America/Vancouver', 'calgary': 'America/Edmonton',
  // Europe
  'uk': 'Europe/London', 'united kingdom': 'Europe/London', 'england': 'Europe/London', 'london': 'Europe/London', 'scotland': 'Europe/London', 'ireland': 'Europe/Dublin', 'dublin': 'Europe/Dublin', 'portugal': 'Europe/Lisbon', 'lisbon': 'Europe/Lisbon',
  'spain': 'Europe/Madrid', 'madrid': 'Europe/Madrid', 'barcelona': 'Europe/Madrid', 'france': 'Europe/Paris', 'paris': 'Europe/Paris', 'germany': 'Europe/Berlin', 'berlin': 'Europe/Berlin', 'munich': 'Europe/Berlin', 'italy': 'Europe/Rome', 'rome': 'Europe/Rome', 'milan': 'Europe/Rome',
  'netherlands': 'Europe/Amsterdam', 'amsterdam': 'Europe/Amsterdam', 'belgium': 'Europe/Brussels', 'switzerland': 'Europe/Zurich', 'zurich': 'Europe/Zurich', 'austria': 'Europe/Vienna', 'poland': 'Europe/Warsaw', 'warsaw': 'Europe/Warsaw', 'czechia': 'Europe/Prague', 'czech republic': 'Europe/Prague', 'prague': 'Europe/Prague',
  'hungary': 'Europe/Budapest', 'budapest': 'Europe/Budapest', 'romania': 'Europe/Bucharest', 'bulgaria': 'Europe/Sofia', 'sofia': 'Europe/Sofia', 'greece': 'Europe/Athens', 'athens': 'Europe/Athens', 'sweden': 'Europe/Stockholm', 'stockholm': 'Europe/Stockholm', 'norway': 'Europe/Oslo', 'denmark': 'Europe/Copenhagen', 'finland': 'Europe/Helsinki',
  'ukraine': 'Europe/Kyiv', 'kyiv': 'Europe/Kyiv', 'turkey': 'Europe/Istanbul', 'turkiye': 'Europe/Istanbul', 'istanbul': 'Europe/Istanbul', 'russia': 'Europe/Moscow', 'moscow': 'Europe/Moscow', 'serbia': 'Europe/Belgrade', 'croatia': 'Europe/Zagreb',
  // Africa, Middle East
  'egypt': 'Africa/Cairo', 'cairo': 'Africa/Cairo', 'nigeria': 'Africa/Lagos', 'lagos': 'Africa/Lagos', 'ghana': 'Africa/Accra', 'accra': 'Africa/Accra', 'kenya': 'Africa/Nairobi', 'nairobi': 'Africa/Nairobi', 'south africa': 'Africa/Johannesburg', 'senegal': 'Africa/Dakar', 'morocco': 'Africa/Casablanca', 'ethiopia': 'Africa/Addis_Ababa',
  'israel': 'Asia/Jerusalem', 'tel aviv': 'Asia/Jerusalem', 'uae': 'Asia/Dubai', 'dubai': 'Asia/Dubai', 'saudi arabia': 'Asia/Riyadh', 'qatar': 'Asia/Qatar',
  // Asia, Oceania
  'india': 'Asia/Kolkata', 'bangalore': 'Asia/Kolkata', 'bengaluru': 'Asia/Kolkata', 'mumbai': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata', 'hyderabad': 'Asia/Kolkata', 'pune': 'Asia/Kolkata', 'chennai': 'Asia/Kolkata', 'pakistan': 'Asia/Karachi', 'bangladesh': 'Asia/Dhaka', 'sri lanka': 'Asia/Colombo', 'nepal': 'Asia/Kathmandu',
  'china': 'Asia/Shanghai', 'shanghai': 'Asia/Shanghai', 'beijing': 'Asia/Shanghai', 'hong kong': 'Asia/Hong_Kong', 'taiwan': 'Asia/Taipei', 'japan': 'Asia/Tokyo', 'tokyo': 'Asia/Tokyo', 'south korea': 'Asia/Seoul', 'korea': 'Asia/Seoul', 'seoul': 'Asia/Seoul',
  'singapore': 'Asia/Singapore', 'malaysia': 'Asia/Kuala_Lumpur', 'indonesia': 'Asia/Jakarta', 'jakarta': 'Asia/Jakarta', 'thailand': 'Asia/Bangkok', 'bangkok': 'Asia/Bangkok', 'vietnam': 'Asia/Ho_Chi_Minh', 'philippines': 'Asia/Manila', 'manila': 'Asia/Manila',
  'australia': 'Australia/Sydney', 'sydney': 'Australia/Sydney', 'melbourne': 'Australia/Melbourne', 'perth': 'Australia/Perth', 'new zealand': 'Pacific/Auckland', 'auckland': 'Pacific/Auckland',
}

const offsetCache = new Map()
/** Current UTC offset in hours for an IANA zone (DST-aware), or null. */
export function zoneOffset(zone) {
  if (!zone) return null
  if (offsetCache.has(zone)) return offsetCache.get(zone)
  let off = null
  try {
    const now = new Date()
    const local = new Date(now.toLocaleString('en-US', { timeZone: zone }))
    const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
    off = Math.round(((local - utc) / 3600000) * 4) / 4
  } catch { off = null }
  offsetCache.set(zone, off)
  return off
}

/** The IANA zone (or a numeric offset) for a person: tz first, then location words. */
export function zoneFor(person) {
  const tz = String(person?.tz || '').trim()
  if (tz) {
    const m = tz.match(/^(?:utc|gmt)?\s*([+-]\d{1,2})(?::?(\d{2}))?$/i)
    if (m) return { zone: null, offset: Number(m[1]) + (m[2] ? Math.sign(Number(m[1]) || 1) * Number(m[2]) / 60 : 0), label: `UTC${Number(m[1]) >= 0 ? '+' : ''}${m[1]}` }
    if (zoneOffset(tz) !== null) return { zone: tz, offset: zoneOffset(tz), label: tz }
  }
  const loc = String(person?.location || '').toLowerCase().replace(/[.]/g, '')
  if (!loc) return null
  const tries = [loc, ...(loc.match(/\(([^)]+)\)/g) || []).map(s => s.slice(1, -1).trim()), ...loc.split(/[,(/)\-]+/).map(s => s.trim()).filter(Boolean)]
  for (const t of tries) { if (ZONES[t]) return { zone: ZONES[t], offset: zoneOffset(ZONES[t]), label: ZONES[t] } }
  return null
}

const SLOTS = 48  // half hours, UTC
/** 48 booleans: which UTC half-hours fall inside the person's local core window. */
export function coreSlots(offset, start = 9, end = 17) {
  const out = new Array(SLOTS).fill(false)
  for (let i = 0; i < SLOTS; i++) {
    const local = (((i / 2) + offset) % 24 + 24) % 24
    out[i] = local >= start && local < end
  }
  return out
}

/** Shared core hours for a list of people. */
export function coreOverlap(people, { start = 9, end = 17 } = {}) {
  const known = [], unknown = []
  for (const p of people) {
    const z = zoneFor(p)
    if (z && z.offset !== null && z.offset !== undefined) known.push({ person: p, offset: z.offset, label: z.label, slots: coreSlots(z.offset, start, end) })
    else unknown.push(p)
  }
  if (known.length < 2) return { hours: null, known, unknown, shared: null }
  const shared = new Array(SLOTS).fill(true)
  for (const k of known) for (let i = 0; i < SLOTS; i++) if (!k.slots[i]) shared[i] = false
  const hours = shared.filter(Boolean).length / 2
  return { hours, known, unknown, shared }
}

export const fmtOffset = off => off === null || off === undefined ? '?' : `UTC${off >= 0 ? '+' : ''}${Number.isInteger(off) ? off : off.toFixed(1)}`
