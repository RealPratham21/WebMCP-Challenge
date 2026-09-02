import {
  parseCidr,
  parseIPv4,
  inCidr,
  networkAddress,
  longestPrefixMatch,
  formatCidr,
  ipv4ToString,
  type Cidr,
} from './ipv4'
import {
  deviceOwnsIp,
  getDevice,
  getInterfaces,
  getPrimaryIPv4,
  neighborOnInterface,
} from './topology'
import type {
  Device,
  FailureReason,
  HopDecision,
  Network,
  NetworkInterface,
  PingResult,
  RouterDevice,
  SimulationResult,
} from './types'
import { isPc, isRouter } from './types'

export const MAX_HOPS = 16

interface ParsedIface {
  iface: NetworkInterface
  ip: number
  cidr: Cidr
}

interface NextHop {
  device: Device
  outgoingInterfaceId: string
  nextHop?: string
  matchedRoute?: string
}

interface DecisionFailure {
  reason: FailureReason
  message: string
}

type Decision = { ok: true; next: NextHop } | { ok: false; failure: DecisionFailure }

function resultBase(
  source: Device,
  dest: Device,
  sourceIp: string,
  destinationIp: string,
): Omit<SimulationResult, 'success' | 'hops'> {
  return {
    sourceDeviceId: source.id,
    destinationDeviceId: dest.id,
    sourceIp,
    destinationIp,
  }
}

function fail(
  source: Device,
  dest: Device,
  sourceIp: string,
  destinationIp: string,
  hops: HopDecision[],
  reason: FailureReason,
  message: string,
  failureDeviceId?: string,
): SimulationResult {
  return {
    ...resultBase(source, dest, sourceIp, destinationIp),
    success: false,
    hops,
    failureReason: reason,
    failureMessage: message,
    failureDeviceId,
  }
}

function parseIface(iface: NetworkInterface): ParsedIface | null {
  const ip = parseIPv4(iface.ipv4)
  if (ip === null || iface.prefix === null) return null
  return {
    iface,
    ip,
    cidr: { network: networkAddress(ip, iface.prefix), prefix: iface.prefix },
  }
}

function configuredInterfaces(device: Device): ParsedIface[] {
  const parsed: ParsedIface[] = []
  for (const iface of getInterfaces(device)) {
    const value = parseIface(iface)
    if (value) parsed.push(value)
  }
  return parsed
}

function dropHop(device: Device, reason: string): HopDecision {
  return {
    deviceId: device.id,
    deviceName: device.name,
    action: 'drop',
    reason,
  }
}

function decideFromPc(network: Network, device: Device, destIp: number): Decision {
  if (!isPc(device)) {
    return { ok: false, failure: { reason: 'INVALID_CONFIGURATION', message: 'Expected a PC' } }
  }

  const parsed = parseIface(device.iface)
  if (!device.iface.ipv4.trim() || device.iface.prefix === null) {
    return {
      ok: false,
      failure: {
        reason: 'INTERFACE_UNCONFIGURED',
        message: `Interface ${device.iface.name} has no IPv4/CIDR configuration`,
      },
    }
  }
  if (!parsed) {
    return {
      ok: false,
      failure: {
        reason: 'INVALID_CONFIGURATION',
        message: `Invalid IPv4/CIDR on ${device.name} ${device.iface.name}`,
      },
    }
  }

  const neighbor = neighborOnInterface(network, device.id, device.iface.id)

  if (inCidr(destIp, parsed.cidr)) {
    if (!neighbor) {
      return {
        ok: false,
        failure: {
          reason: 'DESTINATION_UNREACHABLE',
          message: `Destination ${ipv4ToString(destIp)} is on the local subnet but no neighbor is connected`,
        },
      }
    }
    if (!deviceOwnsIp(neighbor.device, destIp)) {
      return {
        ok: false,
        failure: {
          reason: 'DESTINATION_UNREACHABLE',
          message: `Destination ${ipv4ToString(destIp)} is not reachable on the connected link`,
        },
      }
    }
    return {
      ok: true,
      next: {
        device: neighbor.device,
        outgoingInterfaceId: device.iface.id,
        nextHop: ipv4ToString(destIp),
      },
    }
  }

  const gatewayValue = device.defaultGateway.trim()
  if (!gatewayValue) {
    return {
      ok: false,
      failure: {
        reason: 'NO_DEFAULT_GATEWAY',
        message: `No default gateway configured on ${device.name}`,
      },
    }
  }

  const gatewayIp = parseIPv4(gatewayValue)
  if (gatewayIp === null) {
    return {
      ok: false,
      failure: {
        reason: 'INVALID_GATEWAY',
        message: `Default gateway ${gatewayValue} is not a valid IPv4 address`,
      },
    }
  }

  if (!inCidr(gatewayIp, parsed.cidr)) {
    return {
      ok: false,
      failure: {
        reason: 'INVALID_GATEWAY',
        message: `Default gateway ${gatewayValue} is not on the local subnet ${formatCidr(parsed.cidr)}`,
      },
    }
  }

  if (!neighbor) {
    return {
      ok: false,
      failure: {
        reason: 'INVALID_GATEWAY',
        message: `Default gateway ${gatewayValue} is not reachable; ${device.name} has no connected neighbor`,
      },
    }
  }

  if (!deviceOwnsIp(neighbor.device, gatewayIp)) {
    return {
      ok: false,
      failure: {
        reason: 'INVALID_GATEWAY',
        message: `Default gateway ${gatewayValue} is not present on the connected neighbor`,
      },
    }
  }

  return {
    ok: true,
    next: {
      device: neighbor.device,
      outgoingInterfaceId: device.iface.id,
      nextHop: gatewayValue,
    },
  }
}

function decideFromRouter(network: Network, device: RouterDevice, destIp: number): Decision {
  const configured = configuredInterfaces(device)
  if (configured.length === 0) {
    const hasAnyInterface = device.interfaces.length > 0
    return {
      ok: false,
      failure: {
        reason: hasAnyInterface ? 'INTERFACE_UNCONFIGURED' : 'NO_ROUTE',
        message: hasAnyInterface
          ? `No IPv4/CIDR configured on ${device.name}`
          : `No connected interfaces on ${device.name}`,
      },
    }
  }

  for (const parsed of configured) {
    if (!inCidr(destIp, parsed.cidr)) continue
    const neighbor = neighborOnInterface(network, device.id, parsed.iface.id)
    if (!neighbor) {
      return {
        ok: false,
        failure: {
          reason: 'DESTINATION_UNREACHABLE',
          message: `Destination ${ipv4ToString(destIp)} matches ${parsed.iface.name} (${formatCidr(parsed.cidr)}) but that interface is not connected`,
        },
      }
    }
    if (!deviceOwnsIp(neighbor.device, destIp)) {
      return {
        ok: false,
        failure: {
          reason: 'DESTINATION_UNREACHABLE',
          message: `Destination ${ipv4ToString(destIp)} is not reachable on ${parsed.iface.name}`,
        },
      }
    }
    return {
      ok: true,
      next: {
        device: neighbor.device,
        outgoingInterfaceId: parsed.iface.id,
        nextHop: ipv4ToString(destIp),
        matchedRoute: formatCidr(parsed.cidr),
      },
    }
  }

  const match = longestPrefixMatch(destIp, device.routes)
  if (!match) {
    return {
      ok: false,
      failure: {
        reason: 'NO_ROUTE',
        message: `No route to ${ipv4ToString(destIp)}`,
      },
    }
  }

  const nextHopIp = parseIPv4(match.nextHop)
  if (nextHopIp === null) {
    return {
      ok: false,
      failure: {
        reason: 'INVALID_CONFIGURATION',
        message: `Static route ${match.destinationCidr} has an invalid next hop`,
      },
    }
  }

  const via = configured.find((parsed) => inCidr(nextHopIp, parsed.cidr))
  if (!via) {
    return {
      ok: false,
      failure: {
        reason: 'NEXT_HOP_UNREACHABLE',
        message: `Next hop ${match.nextHop} is not on a connected network`,
      },
    }
  }

  const neighbor = neighborOnInterface(network, device.id, via.iface.id)
  if (!neighbor) {
    return {
      ok: false,
      failure: {
        reason: 'NEXT_HOP_UNREACHABLE',
        message: `Next hop ${match.nextHop} is unreachable; ${via.iface.name} is not connected`,
      },
    }
  }

  if (!deviceOwnsIp(neighbor.device, nextHopIp)) {
    return {
      ok: false,
      failure: {
        reason: 'NEXT_HOP_UNREACHABLE',
        message: `Next hop ${match.nextHop} is not present on the connected neighbor`,
      },
    }
  }

  const matched = parseCidr(match.destinationCidr)
  return {
    ok: true,
    next: {
      device: neighbor.device,
      outgoingInterfaceId: via.iface.id,
      nextHop: match.nextHop,
      matchedRoute: matched ? formatCidr(matched) : match.destinationCidr,
    },
  }
}

function decideNext(network: Network, device: Device, destIp: number): Decision {
  if (isPc(device)) return decideFromPc(network, device, destIp)
  return decideFromRouter(network, device, destIp)
}

function incomingInterfaceId(previous: HopDecision | undefined, nextDeviceId: string, network: Network): string | undefined {
  if (!previous?.outgoingInterfaceId) return undefined
  const neighbor = neighborOnInterface(network, previous.deviceId, previous.outgoingInterfaceId)
  if (!neighbor || neighbor.device.id !== nextDeviceId) return undefined
  return neighbor.remoteIface.id
}

export function tracePacket(
  network: Network,
  sourceDeviceId: string,
  destinationDeviceId: string,
): SimulationResult {
  const source = getDevice(network, sourceDeviceId)
  const dest = getDevice(network, destinationDeviceId)

  if (!source || !dest) {
    return {
      success: false,
      sourceDeviceId,
      destinationDeviceId,
      sourceIp: '',
      destinationIp: '',
      hops: [],
      failureReason: 'INVALID_CONFIGURATION',
      failureMessage: 'Source or destination device does not exist',
    }
  }

  const sourceIpRaw = getPrimaryIPv4(source)
  const destIpRaw = getPrimaryIPv4(dest)
  const sourceIp = sourceIpRaw ?? ''
  const destinationIp = destIpRaw ?? ''

  if (!sourceIpRaw) {
    return fail(
      source,
      dest,
      sourceIp,
      destinationIp,
      [dropHop(source, `No IPv4 address configured on ${source.name}`)],
      'INTERFACE_UNCONFIGURED',
      `No IPv4 address configured on ${source.name}`,
      source.id,
    )
  }

  if (!destIpRaw) {
    return fail(
      source,
      dest,
      sourceIp,
      destinationIp,
      [dropHop(source, `No IPv4 address configured on ${dest.name}`)],
      'INTERFACE_UNCONFIGURED',
      `No IPv4 address configured on ${dest.name}`,
      dest.id,
    )
  }

  const parsedSourceIp = parseIPv4(sourceIpRaw)
  const parsedDestIp = parseIPv4(destIpRaw)
  if (parsedSourceIp === null) {
    return fail(
      source,
      dest,
      sourceIp,
      destinationIp,
      [dropHop(source, `Invalid IPv4 address on ${source.name}`)],
      'INVALID_CONFIGURATION',
      `Invalid IPv4 address on ${source.name}`,
      source.id,
    )
  }
  if (parsedDestIp === null) {
    return fail(
      source,
      dest,
      sourceIp,
      destinationIp,
      [dropHop(source, `Invalid IPv4 address on ${dest.name}`)],
      'INVALID_CONFIGURATION',
      `Invalid IPv4 address on ${dest.name}`,
      dest.id,
    )
  }

  const hops: HopDecision[] = []
  const seen = new Set<string>()
  let current = source

  for (let hopCount = 0; hopCount < MAX_HOPS; hopCount += 1) {
    if (deviceOwnsIp(current, parsedDestIp)) {
      hops.push({
        deviceId: current.id,
        deviceName: current.name,
        action: 'deliver',
        incomingInterfaceId: incomingInterfaceId(hops[hops.length - 1], current.id, network),
      })
      return {
        ...resultBase(source, dest, sourceIp, destinationIp),
        success: true,
        hops,
      }
    }

    if (seen.has(current.id)) {
      hops.push(dropHop(current, 'Routing loop detected'))
      return fail(
        source,
        dest,
        sourceIp,
        destinationIp,
        hops,
        'ROUTING_LOOP',
        'Routing loop detected',
        current.id,
      )
    }
    seen.add(current.id)

    const decision = decideNext(network, current, parsedDestIp)
    if (!decision.ok) {
      hops.push({
        ...dropHop(current, decision.failure.message),
        incomingInterfaceId: incomingInterfaceId(hops[hops.length - 1], current.id, network),
      })
      return fail(
        source,
        dest,
        sourceIp,
        destinationIp,
        hops,
        decision.failure.reason,
        decision.failure.message,
        current.id,
      )
    }

    hops.push({
      deviceId: current.id,
      deviceName: current.name,
      action: hops.length === 0 ? 'source' : 'forward',
      incomingInterfaceId: incomingInterfaceId(hops[hops.length - 1], current.id, network),
      outgoingInterfaceId: decision.next.outgoingInterfaceId,
      nextHop: decision.next.nextHop,
      matchedRoute: decision.next.matchedRoute,
    })

    current = decision.next.device
  }

  hops.push(dropHop(current, `Hop limit (${MAX_HOPS}) exceeded`))
  return fail(
    source,
    dest,
    sourceIp,
    destinationIp,
    hops,
    'ROUTING_LOOP',
    `Hop limit (${MAX_HOPS}) exceeded`,
    current.id,
  )
}

export function formatHopPath(result: SimulationResult): string {
  const names = result.hops.map((hop) => hop.deviceName)
  const path = names.join(' → ')
  if (result.success) return path
  return path ? `${path} ✕` : '✕'
}

export function runPing(
  network: Network,
  sourceDeviceId: string,
  destinationDeviceId: string,
): PingResult {
  const forward = tracePacket(network, sourceDeviceId, destinationDeviceId)
  if (sourceDeviceId === destinationDeviceId) {
    return {
      success: forward.success,
      sourceDeviceId,
      destinationDeviceId,
      forward,
      reverse: null,
    }
  }
  const reverse = tracePacket(network, destinationDeviceId, sourceDeviceId)
  return {
    success: forward.success && reverse.success,
    sourceDeviceId,
    destinationDeviceId,
    forward,
    reverse,
  }
}
