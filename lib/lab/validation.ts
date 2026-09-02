import type { Device, Network } from '../simulator/types'
import { isPc, isRouter } from '../simulator/types'
import { getInterfaces } from '../simulator/topology'
import { inCidr, networkAddress, parseCidr, parseIPv4, validateCidrInput, validateIPv4Input, validatePrefixInput } from '../simulator/ipv4'

export interface FieldError {
  field: string
  message: string
}

export function deviceFieldErrors(device: Device, network: Network): FieldError[] {
  const errors: FieldError[] = []
  const ifaces = getInterfaces(device)

  for (const iface of ifaces) {
    const ipError = validateIPv4Input(iface.ipv4, true)
    if (ipError) errors.push({ field: `iface:${iface.id}:ipv4`, message: ipError })

    const prefixText = iface.prefix === null ? '' : String(iface.prefix)
    const prefixError = validatePrefixInput(prefixText, true)
    if (prefixError) errors.push({ field: `iface:${iface.id}:prefix`, message: prefixError })

    if (iface.ipv4.trim() && iface.prefix === null) {
      errors.push({ field: `iface:${iface.id}:prefix`, message: 'CIDR prefix is required when an IPv4 address is set' })
    }
    if (!iface.ipv4.trim() && iface.prefix !== null) {
      errors.push({ field: `iface:${iface.id}:ipv4`, message: 'IPv4 address is required when a CIDR prefix is set' })
    }

    const ip = iface.ipv4.trim()
    if (ip && parseIPv4(ip)) {
      const duplicate = network.devices.some(
        (other) =>
          other.id !== device.id &&
          getInterfaces(other).some((otherIface) => otherIface.ipv4.trim() === ip),
      )
      if (duplicate) {
        errors.push({ field: `iface:${iface.id}:ipv4`, message: `Address ${ip} is already used by another device` })
      }
    }
  }

  if (isPc(device)) {
    const gwError = validateIPv4Input(device.defaultGateway, true)
    if (gwError) errors.push({ field: 'gateway', message: gwError })

    const parsedIp = parseIPv4(device.iface.ipv4)
    const gw = parseIPv4(device.defaultGateway)
    if (device.defaultGateway.trim() && parsedIp !== null && device.iface.prefix !== null && gw !== null) {
      const cidr = { network: networkAddress(parsedIp, device.iface.prefix), prefix: device.iface.prefix }
      if (!inCidr(gw, cidr)) {
        errors.push({ field: 'gateway', message: 'Default gateway is not on the local subnet' })
      }
    }
  }

  if (isRouter(device)) {
    for (const route of device.routes) {
      const destError = validateCidrInput(route.destinationCidr, true)
      if (destError) errors.push({ field: `route:${route.id}:destination`, message: destError })
      const hopError = validateIPv4Input(route.nextHop, true)
      if (hopError) errors.push({ field: `route:${route.id}:nextHop`, message: hopError })

      const hop = parseIPv4(route.nextHop)
      if (parseCidr(route.destinationCidr) && hop !== null) {
        const onConnected = device.interfaces.some((iface) => {
          const ip = parseIPv4(iface.ipv4)
          if (ip === null || iface.prefix === null) return false
          return inCidr(hop, { network: networkAddress(ip, iface.prefix), prefix: iface.prefix })
        })
        if (!onConnected) {
          errors.push({ field: `route:${route.id}:nextHop`, message: 'Next hop is not on a connected network' })
        }
      }
    }
  }

  return errors
}

export function errorFor(errors: FieldError[], field: string): string | undefined {
  return errors.find((error) => error.field === field)?.message
}

export function pingEndpointLabel(device: Device): string {
  const ip = isPc(device)
    ? device.iface.ipv4.trim()
    : device.interfaces.find((iface) => iface.ipv4.trim())?.ipv4.trim()
  return ip ? `${device.name} (${ip})` : device.name
}
