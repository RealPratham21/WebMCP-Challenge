import type { StaticRoute } from './types'

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4_RE = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`)

export interface Cidr {
  network: number
  prefix: number
}

export function isValidIPv4(value: string): boolean {
  return IPV4_RE.test(value.trim())
}

export function parseIPv4(value: string): number | null {
  const trimmed = value.trim()
  if (!isValidIPv4(trimmed)) return null
  const parts = trimmed.split('.').map(Number)
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0)
}

export function ipv4ToString(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.')
}

export function isValidPrefix(prefix: number): boolean {
  return Number.isInteger(prefix) && prefix >= 0 && prefix <= 32
}

export function parsePrefixInput(value: string): number | null {
  const trimmed = value.trim().replace(/^\//, '')
  if (!/^\d+$/.test(trimmed)) return null
  const prefix = Number(trimmed)
  return isValidPrefix(prefix) ? prefix : null
}

export function prefixToMask(prefix: number): number {
  if (!isValidPrefix(prefix)) return 0
  if (prefix === 0) return 0
  return (0xffffffff << (32 - prefix)) >>> 0
}

export function networkAddress(ip: number, prefix: number): number {
  return (ip & prefixToMask(prefix)) >>> 0
}

export function hostIdentifier(ip: number, prefix: number): number {
  return (ip & ~prefixToMask(prefix)) >>> 0
}

export function parseCidr(value: string): Cidr | null {
  const trimmed = value.trim()
  const slash = trimmed.lastIndexOf('/')
  if (slash <= 0) return null
  const ip = parseIPv4(trimmed.slice(0, slash))
  const prefix = parsePrefixInput(trimmed.slice(slash + 1))
  if (ip === null || prefix === null) return null
  return { network: networkAddress(ip, prefix), prefix }
}

export function formatCidr(cidr: Cidr): string {
  return `${ipv4ToString(cidr.network)}/${cidr.prefix}`
}

export function inCidr(ip: number, cidr: Cidr): boolean {
  return networkAddress(ip, cidr.prefix) === cidr.network
}

export function sameSubnet(
  ip1: number,
  prefix1: number,
  ip2: number,
  prefix2: number,
): boolean {
  if (prefix1 !== prefix2) return false
  return networkAddress(ip1, prefix1) === networkAddress(ip2, prefix2)
}

export function longestPrefixMatch<T extends { destinationCidr: string }>(
  ip: number,
  routes: T[],
): T | null {
  let best: T | null = null
  let bestPrefix = -1
  for (const route of routes) {
    const cidr = parseCidr(route.destinationCidr)
    if (!cidr) continue
    if (cidr.prefix > bestPrefix && inCidr(ip, cidr)) {
      best = route
      bestPrefix = cidr.prefix
    }
  }
  return best
}

export function validateIPv4Input(value: string, allowEmpty = true): string | null {
  const trimmed = value.trim()
  if (!trimmed) return allowEmpty ? null : 'IPv4 address is required'
  if (!isValidIPv4(trimmed)) return 'Invalid IPv4 address'
  return null
}

export function validatePrefixInput(value: string, allowEmpty = true): string | null {
  const trimmed = value.trim()
  if (!trimmed) return allowEmpty ? null : 'CIDR prefix is required'
  if (parsePrefixInput(trimmed) === null) return 'CIDR prefix must be an integer from 0 to 32'
  return null
}

export function validateCidrInput(value: string, allowEmpty = true): string | null {
  const trimmed = value.trim()
  if (!trimmed) return allowEmpty ? null : 'Destination CIDR is required'
  if (!parseCidr(trimmed)) return 'Invalid CIDR (expected address/prefix, e.g. 192.168.2.0/24)'
  return null
}

export function routeMatches(ip: number, route: StaticRoute): boolean {
  const cidr = parseCidr(route.destinationCidr)
  return cidr ? inCidr(ip, cidr) : false
}
