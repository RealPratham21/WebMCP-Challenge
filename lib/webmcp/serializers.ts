import type { LabSnapshot } from '../lab/types'
import { deviceFieldErrors } from '../lab/validation'
import { getDevice, getInterfaces, getPrimaryIPv4, neighborOnInterface } from '../simulator/topology'
import type { Device, HopDecision, Network, NetworkInterface, PingResult, SimulationResult } from '../simulator/types'
import { isPc } from '../simulator/types'
import type {
  AgentConnectivityResult,
  AgentDeviceState,
  AgentEndpoint,
  AgentFailure,
  AgentHop,
  AgentInterface,
  AgentTopology,
} from './types'

function networkOf(snapshot: LabSnapshot): Network {
  return { devices: snapshot.devices, links: snapshot.links }
}

function serializeInterface(network: Network, device: Device, iface: NetworkInterface): AgentInterface {
  const neighbor = neighborOnInterface(network, device.id, iface.id)
  return {
    id: iface.id,
    name: iface.name,
    ipv4: iface.ipv4.trim(),
    prefix: iface.prefix,
    connectedTo: neighbor
      ? { deviceId: neighbor.device.id, deviceName: neighbor.device.name }
      : null,
  }
}

export function serializeTopologyForAgent(snapshot: LabSnapshot): AgentTopology {
  const network = networkOf(snapshot)
  return {
    ok: true,
    labName: snapshot.name,
    devices: snapshot.devices.map((device) => ({
      id: device.id,
      name: device.name,
      type: device.kind,
    })),
    links: snapshot.links.map((link) => ({
      id: link.id,
      sourceDeviceId: link.sourceDeviceId,
      sourceDeviceName: getDevice(network, link.sourceDeviceId)?.name ?? link.sourceDeviceId,
      sourceInterfaceId: link.sourceInterfaceId,
      targetDeviceId: link.targetDeviceId,
      targetDeviceName: getDevice(network, link.targetDeviceId)?.name ?? link.targetDeviceId,
      targetInterfaceId: link.targetInterfaceId,
    })),
  }
}

export function serializeDeviceForAgent(snapshot: LabSnapshot, device: Device): AgentDeviceState {
  const network = networkOf(snapshot)
  const validationIssues = deviceFieldErrors(device, network).map((issue) => ({
    field: issue.field,
    message: issue.message,
  }))

  if (isPc(device)) {
    return {
      ok: true,
      id: device.id,
      name: device.name,
      type: 'pc',
      interface: serializeInterface(network, device, device.iface),
      defaultGateway: device.defaultGateway,
      validationIssues,
    }
  }

  return {
    ok: true,
    id: device.id,
    name: device.name,
    type: 'router',
    interfaces: device.interfaces.map((iface) => serializeInterface(network, device, iface)),
    staticRoutes: device.routes.map((route) => ({
      destination: route.destinationCidr,
      nextHop: route.nextHop,
    })),
    validationIssues,
  }
}

function serializeEndpoint(device: Device): AgentEndpoint {
  return {
    id: device.id,
    name: device.name,
    ipv4: getPrimaryIPv4(device),
  }
}

function serializeHops(hops: HopDecision[]): AgentHop[] {
  return hops.map((hop) => ({
    deviceId: hop.deviceId,
    deviceName: hop.deviceName,
    action: hop.action,
    ...(hop.nextHop ? { nextHop: hop.nextHop } : {}),
    ...(hop.matchedRoute ? { matchedRoute: hop.matchedRoute } : {}),
  }))
}

function serializeFailure(result: SimulationResult, direction: 'forward' | 'reverse'): AgentFailure {
  const drop = result.hops.find((hop) => hop.action === 'drop') ?? result.hops[result.hops.length - 1]
  return {
    direction,
    deviceId: result.failureDeviceId ?? drop?.deviceId,
    deviceName: drop?.deviceName,
    code: result.failureReason ?? 'SIMULATION_FAILED',
    message: result.failureMessage ?? 'Connectivity test failed',
  }
}

export function serializeConnectivityResultForAgent(
  snapshot: LabSnapshot,
  ping: PingResult,
): AgentConnectivityResult {
  const network = networkOf(snapshot)
  const source = getDevice(network, ping.sourceDeviceId)
  const destination = getDevice(network, ping.destinationDeviceId)

  let failure: AgentFailure | null = null
  if (!ping.forward.success) {
    failure = serializeFailure(ping.forward, 'forward')
  } else if (ping.reverse && !ping.reverse.success) {
    failure = serializeFailure(ping.reverse, 'reverse')
  }

  return {
    ok: true,
    success: ping.success,
    source: source
      ? serializeEndpoint(source)
      : { id: ping.sourceDeviceId, name: ping.sourceDeviceId, ipv4: ping.forward.sourceIp || null },
    destination: destination
      ? serializeEndpoint(destination)
      : { id: ping.destinationDeviceId, name: ping.destinationDeviceId, ipv4: ping.forward.destinationIp || null },
    forwardPath: serializeHops(ping.forward.hops),
    reversePath: ping.reverse ? serializeHops(ping.reverse.hops) : null,
    failure,
  }
}

export function missingDeviceError(deviceId: string) {
  return {
    ok: false as const,
    error: {
      code: 'INVALID_DEVICE_ID' as const,
      message: `No device exists with id '${deviceId}'. Call get_topology to obtain current device IDs.`,
    },
  }
}
