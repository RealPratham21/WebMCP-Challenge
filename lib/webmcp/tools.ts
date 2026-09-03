import type { LabSnapshot } from '../lab/types'
import { deviceFieldErrors } from '../lab/validation'
import { parseCidr, parseIPv4 } from '../simulator/ipv4'
import { getDevice } from '../simulator/topology'
import type { RouterDevice, StaticRoute } from '../simulator/types'
import { isRouter } from '../simulator/types'
import {
  missingDeviceError,
  serializeConnectivityResultForAgent,
  serializeDeviceForAgent,
  serializeStaticRouteForAgent,
  serializeTopologyForAgent,
} from './serializers'
import type {
  AgentConnectivityResult,
  AgentDeviceState,
  AgentError,
  AgentHighlightResult,
  AgentRouteMutationResult,
  AgentTopology,
  WebMcpErrorCode,
} from './types'

export interface LabAccess {
  getSnapshot: () => LabSnapshot
  runPing: (sourceDeviceId: string, destinationDeviceId: string) => void
}

export interface LabWriteAccess extends LabAccess {
  addStaticRoute: (deviceId: string, route: { destinationCidr: string; nextHop: string }) => void
  removeStaticRoute: (deviceId: string, routeId: string) => void
  selectDevice: (deviceId: string) => void
}

function asId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function fail(code: WebMcpErrorCode, message: string): AgentError {
  return { ok: false, error: { code, message } }
}

function routesMatch(route: StaticRoute, destination: string, nextHop: string): boolean {
  const left = parseCidr(route.destinationCidr)
  const right = parseCidr(destination)
  const leftHop = parseIPv4(route.nextHop)
  const rightHop = parseIPv4(nextHop)
  if (left && right && leftHop !== null && rightHop !== null) {
    return left.network === right.network && left.prefix === right.prefix && leftHop === rightHop
  }
  return route.destinationCidr.trim() === destination.trim() && route.nextHop.trim() === nextHop.trim()
}

function requireRouter(
  snapshot: LabSnapshot,
  deviceIdRaw: unknown,
): { device: RouterDevice } | AgentError {
  const deviceId = asId(deviceIdRaw)
  if (!deviceId) {
    return fail(
      'INVALID_DEVICE_ID',
      'A deviceId string is required. Call get_topology to obtain current device IDs.',
    )
  }
  const device = getDevice({ devices: snapshot.devices, links: snapshot.links }, deviceId)
  if (!device) return missingDeviceError(deviceId)
  if (!isRouter(device)) {
    return fail(
      'DEVICE_NOT_ROUTER',
      `'${device.name}' (${device.id}) is a ${device.kind}, not a router. Static routes can only be changed on routers.`,
    )
  }
  return { device }
}

export function getTopology(snapshot: LabSnapshot): AgentTopology {
  return serializeTopologyForAgent(snapshot)
}

export function getDeviceState(snapshot: LabSnapshot, deviceIdRaw: unknown): AgentDeviceState | AgentError {
  const deviceId = asId(deviceIdRaw)
  if (!deviceId) {
    return fail(
      'INVALID_DEVICE_ID',
      'A deviceId string is required. Call get_topology to obtain current device IDs.',
    )
  }
  const device = getDevice({ devices: snapshot.devices, links: snapshot.links }, deviceId)
  if (!device) return missingDeviceError(deviceId)
  return serializeDeviceForAgent(snapshot, device)
}

export function testConnectivity(
  lab: LabAccess,
  sourceIdRaw: unknown,
  destinationIdRaw: unknown,
): AgentConnectivityResult | AgentError {
  const sourceDeviceId = asId(sourceIdRaw)
  const destinationDeviceId = asId(destinationIdRaw)
  const snapshot = lab.getSnapshot()
  const network = { devices: snapshot.devices, links: snapshot.links }

  if (!sourceDeviceId) {
    return fail('SOURCE_NOT_ENDPOINT', 'sourceDeviceId is required. Call get_topology to obtain current device IDs.')
  }
  if (!destinationDeviceId) {
    return fail(
      'DESTINATION_NOT_ENDPOINT',
      'destinationDeviceId is required. Call get_topology to obtain current device IDs.',
    )
  }

  const source = getDevice(network, sourceDeviceId)
  if (!source) {
    return fail(
      'INVALID_DEVICE_ID',
      `No device exists with id '${sourceDeviceId}'. Call get_topology to obtain current device IDs.`,
    )
  }
  const destination = getDevice(network, destinationDeviceId)
  if (!destination) {
    return fail(
      'INVALID_DEVICE_ID',
      `No device exists with id '${destinationDeviceId}'. Call get_topology to obtain current device IDs.`,
    )
  }

  try {
    lab.runPing(sourceDeviceId, destinationDeviceId)
    const next = lab.getSnapshot()
    if (!next.lastPing) {
      return fail('SIMULATION_FAILED', 'The simulator did not produce a connectivity result.')
    }
    return serializeConnectivityResultForAgent(next, next.lastPing)
  } catch {
    return fail('SIMULATION_FAILED', 'Connectivity test failed unexpectedly. The live lab was not modified.')
  }
}

export function addStaticRoute(
  lab: LabWriteAccess,
  deviceIdRaw: unknown,
  destinationRaw: unknown,
  nextHopRaw: unknown,
): AgentRouteMutationResult | AgentError {
  const snapshot = lab.getSnapshot()
  const router = requireRouter(snapshot, deviceIdRaw)
  if (!('device' in router)) return router

  const destination = asId(destinationRaw)
  const nextHop = asId(nextHopRaw)
  if (!destination) {
    return fail('INVALID_CIDR', 'destination is required and must be an IPv4 CIDR such as 192.168.1.0/24.')
  }
  if (!nextHop) {
    return fail('INVALID_NEXT_HOP', 'nextHop is required and must be an IPv4 address such as 10.0.0.1.')
  }

  const pendingId = '__webmcp-pending-route'
  const pendingDevice: RouterDevice = {
    ...router.device,
    routes: [...router.device.routes, { id: pendingId, destinationCidr: destination, nextHop }],
  }
  const pendingErrors = deviceFieldErrors(pendingDevice, {
    devices: snapshot.devices,
    links: snapshot.links,
  }).filter((issue) => issue.field.startsWith(`route:${pendingId}:`))

  const destinationError = pendingErrors.find((issue) => issue.field.endsWith(':destination'))
  if (destinationError) {
    return fail('INVALID_CIDR', destinationError.message)
  }
  const nextHopError = pendingErrors.find((issue) => issue.field.endsWith(':nextHop'))
  if (nextHopError) {
    return fail('INVALID_NEXT_HOP', nextHopError.message)
  }

  if (router.device.routes.some((route) => routesMatch(route, destination, nextHop))) {
    return fail(
      'ROUTE_ALREADY_EXISTS',
      `Router '${router.device.name}' already has a static route to ${destination} via ${nextHop}.`,
    )
  }

  try {
    const beforeIds = new Set(router.device.routes.map((route) => route.id))
    lab.addStaticRoute(router.device.id, { destinationCidr: destination, nextHop })
    lab.selectDevice(router.device.id)
    const next = lab.getSnapshot()
    const updated = getDevice({ devices: next.devices, links: next.links }, router.device.id)
    if (!updated || !isRouter(updated)) {
      return fail('SIMULATION_FAILED', 'The route could not be added to the live lab.')
    }
    const added = updated.routes.find((route) => !beforeIds.has(route.id))
    if (!added) {
      return fail('SIMULATION_FAILED', 'The route could not be added to the live lab.')
    }
    return {
      ok: true,
      deviceId: updated.id,
      deviceName: updated.name,
      route: serializeStaticRouteForAgent(added),
    }
  } catch {
    return fail('SIMULATION_FAILED', 'Adding the static route failed unexpectedly. The live lab was not modified.')
  }
}

export function removeStaticRoute(
  lab: LabWriteAccess,
  args: { deviceId?: unknown; routeId?: unknown; destination?: unknown; nextHop?: unknown },
): AgentRouteMutationResult | AgentError {
  const snapshot = lab.getSnapshot()
  const router = requireRouter(snapshot, args.deviceId)
  if (!('device' in router)) return router

  const routeId = asId(args.routeId)
  const destination = asId(args.destination)
  const nextHop = asId(args.nextHop)

  let match: StaticRoute | undefined
  if (routeId) {
    match = router.device.routes.find((route) => route.id === routeId)
  } else if (destination && nextHop) {
    match = router.device.routes.find((route) => routesMatch(route, destination, nextHop))
  } else {
    return fail(
      'INVALID_CONFIGURATION',
      'Provide routeId from get_device_state, or both destination and nextHop to identify the route.',
    )
  }

  if (!match) {
    return fail(
      'ROUTE_NOT_FOUND',
      routeId
        ? `Router '${router.device.name}' has no static route with id '${routeId}'.`
        : `Router '${router.device.name}' has no static route to ${destination} via ${nextHop}.`,
    )
  }

  try {
    lab.removeStaticRoute(router.device.id, match.id)
    lab.selectDevice(router.device.id)
    const next = lab.getSnapshot()
    const updated = getDevice({ devices: next.devices, links: next.links }, router.device.id)
    if (!updated || !isRouter(updated) || updated.routes.some((route) => route.id === match.id)) {
      return fail('SIMULATION_FAILED', 'The route could not be removed from the live lab.')
    }
    return {
      ok: true,
      deviceId: updated.id,
      deviceName: updated.name,
      route: serializeStaticRouteForAgent(match),
    }
  } catch {
    return fail('SIMULATION_FAILED', 'Removing the static route failed unexpectedly. The live lab was not modified.')
  }
}

export function highlightDevice(
  lab: LabWriteAccess,
  deviceIdRaw: unknown,
): AgentHighlightResult | AgentError {
  const deviceId = asId(deviceIdRaw)
  if (!deviceId) {
    return fail(
      'INVALID_DEVICE_ID',
      'A deviceId string is required. Call get_topology to obtain current device IDs.',
    )
  }

  const snapshot = lab.getSnapshot()
  const device = getDevice({ devices: snapshot.devices, links: snapshot.links }, deviceId)
  if (!device) return missingDeviceError(deviceId)

  try {
    lab.selectDevice(device.id)
    return {
      ok: true,
      deviceId: device.id,
      deviceName: device.name,
    }
  } catch {
    return fail('SIMULATION_FAILED', 'The device could not be highlighted.')
  }
}
