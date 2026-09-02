import { describe, expect, it } from 'vitest'
import {
  formatCidr,
  inCidr,
  ipv4ToString,
  isValidIPv4,
  isValidPrefix,
  longestPrefixMatch,
  networkAddress,
  parseCidr,
  parseIPv4,
  parsePrefixInput,
  sameSubnet,
  validateCidrInput,
  validateIPv4Input,
} from './ipv4'

describe('IPv4 parsing and validation', () => {
  it('parses and validates IPv4 addresses', () => {
    expect(isValidIPv4('192.168.1.10')).toBe(true)
    expect(isValidIPv4('0.0.0.0')).toBe(true)
    expect(isValidIPv4('255.255.255.255')).toBe(true)
    expect(parseIPv4('10.0.0.1')).toBe(0x0a000001)
    expect(ipv4ToString(0x0a000001)).toBe('10.0.0.1')
  })

  it('rejects malformed addresses', () => {
    expect(isValidIPv4('')).toBe(false)
    expect(isValidIPv4('192.168.1')).toBe(false)
    expect(isValidIPv4('192.168.1.256')).toBe(false)
    expect(isValidIPv4('192.168.1.1/24')).toBe(false)
    expect(isValidIPv4('not-an-ip')).toBe(false)
    expect(parseIPv4('999.1.1.1')).toBeNull()
    expect(validateIPv4Input('banana', false)).toMatch(/invalid/i)
  })

  it('validates CIDR prefixes', () => {
    expect(isValidPrefix(0)).toBe(true)
    expect(isValidPrefix(24)).toBe(true)
    expect(isValidPrefix(32)).toBe(true)
    expect(isValidPrefix(-1)).toBe(false)
    expect(isValidPrefix(33)).toBe(false)
    expect(parsePrefixInput('/24')).toBe(24)
    expect(parsePrefixInput('24')).toBe(24)
    expect(parsePrefixInput('99')).toBeNull()
  })

  it('parses CIDR networks and masks host bits', () => {
    expect(parseCidr('192.168.1.10/24')).toEqual({
      network: parseIPv4('192.168.1.0'),
      prefix: 24,
    })
    expect(formatCidr(parseCidr('10.0.0.1/30')!)).toBe('10.0.0.0/30')
    expect(parseCidr('192.168.1.0')).toBeNull()
    expect(validateCidrInput('192.168.1.0/99')).toMatch(/invalid/i)
  })

  it('detects same-subnet membership', () => {
    const a = parseIPv4('192.168.1.10')!
    const b = parseIPv4('192.168.1.20')!
    const c = parseIPv4('192.168.2.10')!
    expect(sameSubnet(a, 24, b, 24)).toBe(true)
    expect(sameSubnet(a, 24, c, 24)).toBe(false)
    expect(inCidr(b, { network: networkAddress(a, 24), prefix: 24 })).toBe(true)
    expect(inCidr(c, { network: networkAddress(a, 24), prefix: 24 })).toBe(false)
  })

  it('selects routes with longest-prefix matching', () => {
    const routes = [
      { destinationCidr: '10.0.0.0/8', nextHop: '1.1.1.1' },
      { destinationCidr: '10.1.0.0/16', nextHop: '2.2.2.2' },
      { destinationCidr: '10.1.2.0/24', nextHop: '3.3.3.3' },
    ]
    expect(longestPrefixMatch(parseIPv4('10.1.2.4')!, routes)?.nextHop).toBe('3.3.3.3')
    expect(longestPrefixMatch(parseIPv4('10.1.9.1')!, routes)?.nextHop).toBe('2.2.2.2')
    expect(longestPrefixMatch(parseIPv4('10.2.0.1')!, routes)?.nextHop).toBe('1.1.1.1')
    expect(longestPrefixMatch(parseIPv4('11.0.0.1')!, routes)).toBeNull()
  })
})
