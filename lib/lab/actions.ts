import type {
  Device,
  DeviceKind,
  Link,
  Network,
  NetworkInterface,
  PcDevice,
  RouterDevice,
  StaticRoute,
} from '../simulator/types'
import { isPc, isRouter } from '../simulator/types'
import { formatHopPath, runPing as simulatePing, tracePacket as simulateTrace } from '../simulator/engine'
import { cloneNetwork, getPreset, WORKING_STATIC_ROUTING } from '../simulator/presets'
import {
  canConnectDevices,
  getDevice,
  nextInterfaceName,
  unusedInterfaces,
} from '../simulator/topology'
import type { LabSnapshot, TraceEvent } from './types'

export type InterfaceConfig = {
  ipv4?: string
  prefix?: number | null
}

function nowTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function nextSeq(state: LabSnapshot): { idSeq: number; id: number } {
  const idSeq = state.idSeq + 1
  return { idSeq, id: idSeq }
}

function nextDeviceName(devices: Device[], kind: DeviceKind): string {
  const prefix = kind === 'pc' ? 'PC' : 'Router'
  const used = new Set(devices.map((device) => device.name))
  let n = 1
  while (used.has(`${prefix}-${String(n).padStart(2, '0')}`)) n += 1
  return `${prefix}-${String(n).padStart(2, '0')}`
}

function firstPcs(devices: Device[]): { source: string | null; dest: string | null } {
  const pcs = devices.filter(isPc)
  return {
    source: pcs[0]?.id ?? devices[0]?.id ?? null,
    dest: pcs[1]?.id ?? devices[1]?.id ?? null,
  }
}

function networkOf(state: LabSnapshot): Network {
  return { devices: state.devices, links: state.links }
}

function replaceDevice(state: LabSnapshot, device: Device): LabSnapshot {
  return {
    ...state,
    devices: state.devices.map((item) => (item.id === device.id ? device : item)),
  }
}

function allocateInterface(state: LabSnapshot, device: Device): { state: LabSnapshot; device: Device; iface: NetworkInterface } {
  const free = unusedInterfaces(networkOf(state), device)
  if (free[0]) return { state, device, iface: free[0] }

  if (isPc(device)) {
    return { state, device, iface: device.iface }
  }

  const name = nextInterfaceName(device)
  const iface: NetworkInterface = {
    id: `${device.id}-${name}`,
    name,
    ipv4: '',
    prefix: null,
  }
  const updated: RouterDevice = { ...device, interfaces: [...device.interfaces, iface] }
  return { state: replaceDevice(state, updated), device: updated, iface }
}

export function emptyLab(): LabSnapshot {
  return {
    name: 'Untitled network',
    presetId: null,
    devices: [],
    links: [],
    selectedDeviceId: null,
    selectedLinkId: null,
    pingSourceId: null,
    pingDestinationId: null,
    lastPing: null,
    traces: [],
    idSeq: 0,
  }
}

export function labFromPreset(presetId: string): LabSnapshot {
  const preset = getPreset(presetId) ?? WORKING_STATIC_ROUTING
  const network = cloneNetwork(preset.network)
  const ping = firstPcs(network.devices)
  const selected = network.devices.find(isRouter)?.id ?? network.devices[0]?.id ?? null
  return {
    name: preset.name,
    presetId: preset.id,
    devices: network.devices,
    links: network.links,
    selectedDeviceId: selected,
    selectedLinkId: null,
    pingSourceId: ping.source,
    pingDestinationId: ping.dest,
    lastPing: null,
    traces: [],
    idSeq: 100,
  }
}

export function addDevice(state: LabSnapshot, kind: DeviceKind): LabSnapshot {
  const { idSeq, id } = nextSeq(state)
  const deviceId = `${kind}-${id}`
  const name = nextDeviceName(state.devices, kind)
  const position = { x: 220 + state.devices.length * 36, y: 280 }

  const device: Device = kind === 'pc'
    ? {
        id: deviceId,
        kind: 'pc',
        name,
        position,
        iface: { id: `${deviceId}-eth0`, name: 'eth0', ipv4: '', prefix: null },
        defaultGateway: '',
      }
    : {
        id: deviceId,
        kind: 'router',
        name,
        position,
        interfaces: [],
        routes: [],
      }

  const pingSourceId = state.pingSourceId ?? (kind === 'pc' ? deviceId : state.pingSourceId)
  const pingDestinationId =
    state.pingDestinationId ??
    (kind === 'pc' && state.pingSourceId && state.pingSourceId !== deviceId ? deviceId : state.pingDestinationId)

  return {
    ...state,
    idSeq,
    presetId: null,
    devices: [...state.devices, device],
    selectedDeviceId: deviceId,
    selectedLinkId: null,
    pingSourceId,
    pingDestinationId,
    lastPing: null,
  }
}

export function removeDevice(state: LabSnapshot, deviceId: string): LabSnapshot {
  const devices = state.devices.filter((device) => device.id !== deviceId)
  const links = state.links.filter(
    (link) => link.sourceDeviceId !== deviceId && link.targetDeviceId !== deviceId,
  )
  const ping = firstPcs(devices)
  return {
    ...state,
    presetId: null,
    devices,
    links,
    selectedDeviceId: state.selectedDeviceId === deviceId ? null : state.selectedDeviceId,
    pingSourceId: state.pingSourceId === deviceId ? ping.source : state.pingSourceId,
    pingDestinationId: state.pingDestinationId === deviceId ? ping.dest : state.pingDestinationId,
    lastPing: null,
  }
}

export function connectDevices(state: LabSnapshot, sourceId: string, targetId: string): LabSnapshot {
  if (!canConnectDevices(networkOf(state), sourceId, targetId)) return state

  const source = getDevice(networkOf(state), sourceId)
  const target = getDevice(networkOf(state), targetId)
  if (!source || !target) return state

  const allocatedSource = allocateInterface(state, source)
  const allocatedTarget = allocateInterface(allocatedSource.state, getDevice(allocatedSource.state, targetId)!)
  const { idSeq, id } = nextSeq(allocatedTarget.state)

  const link: Link = {
    id: `link-${id}`,
    sourceDeviceId: sourceId,
    sourceInterfaceId: allocatedSource.iface.id,
    targetDeviceId: targetId,
    targetInterfaceId: allocatedTarget.iface.id,
  }

  return {
    ...allocatedTarget.state,
    idSeq,
    presetId: null,
    links: [...allocatedTarget.state.links, link],
    lastPing: null,
  }
}

export function disconnectDevices(state: LabSnapshot, linkId: string): LabSnapshot {
  return {
    ...state,
    presetId: null,
    links: state.links.filter((link) => link.id !== linkId),
    selectedLinkId: state.selectedLinkId === linkId ? null : state.selectedLinkId,
    lastPing: null,
  }
}

export function renameDevice(state: LabSnapshot, deviceId: string, name: string): LabSnapshot {
  const device = getDevice(networkOf(state), deviceId)
  if (!device) return state
  return replaceDevice(state, { ...device, name })
}

export function moveDevice(state: LabSnapshot, deviceId: string, position: { x: number; y: number }): LabSnapshot {
  const device = getDevice(networkOf(state), deviceId)
  if (!device) return state
  return replaceDevice(state, { ...device, position })
}

export function configureInterface(
  state: LabSnapshot,
  deviceId: string,
  interfaceId: string,
  config: InterfaceConfig,
): LabSnapshot {
  const device = getDevice(networkOf(state), deviceId)
  if (!device) return state

  const apply = (iface: NetworkInterface): NetworkInterface => {
    if (iface.id !== interfaceId) return iface
    return {
      ...iface,
      ipv4: config.ipv4 !== undefined ? config.ipv4 : iface.ipv4,
      prefix: config.prefix !== undefined ? config.prefix : iface.prefix,
    }
  }

  const next = isPc(device)
    ? replaceDevice(state, { ...device, iface: apply(device.iface) })
    : replaceDevice(state, { ...device, interfaces: device.interfaces.map(apply) })
  return { ...next, lastPing: null }
}

export function setDefaultGateway(state: LabSnapshot, deviceId: string, gateway: string): LabSnapshot {
  const device = getDevice(networkOf(state), deviceId)
  if (!device || !isPc(device)) return state
  return { ...replaceDevice(state, { ...device, defaultGateway: gateway }), lastPing: null }
}

export function addStaticRoute(
  state: LabSnapshot,
  deviceId: string,
  route?: { destinationCidr: string; nextHop: string },
): LabSnapshot {
  const device = getDevice(networkOf(state), deviceId)
  if (!device || !isRouter(device)) return state
  const { idSeq, id } = nextSeq(state)
  const next: StaticRoute = {
    id: `${deviceId}-route-${id}`,
    destinationCidr: route?.destinationCidr ?? '',
    nextHop: route?.nextHop ?? '',
  }
  return {
    ...replaceDevice(state, { ...device, routes: [...device.routes, next] }),
    idSeq,
    lastPing: null,
  }
}

export function updateStaticRoute(
  state: LabSnapshot,
  deviceId: string,
  routeId: string,
  patch: Partial<Pick<StaticRoute, 'destinationCidr' | 'nextHop'>>,
): LabSnapshot {
  const device = getDevice(networkOf(state), deviceId)
  if (!device || !isRouter(device)) return state
  return {
    ...replaceDevice(state, {
      ...device,
      routes: device.routes.map((item) => (item.id === routeId ? { ...item, ...patch } : item)),
    }),
    lastPing: null,
  }
}

export function removeStaticRoute(state: LabSnapshot, deviceId: string, routeId: string): LabSnapshot {
  const device = getDevice(networkOf(state), deviceId)
  if (!device || !isRouter(device)) return state
  return {
    ...replaceDevice(state, {
      ...device,
      routes: device.routes.filter((item) => item.id !== routeId),
    }),
    lastPing: null,
  }
}

export function removeInterface(state: LabSnapshot, deviceId: string, interfaceId: string): LabSnapshot {
  const device = getDevice(networkOf(state), deviceId)
  if (!device || !isRouter(device)) return state
  const nextState: LabSnapshot = {
    ...state,
    presetId: null,
    links: state.links.filter(
      (link) =>
        !(
          (link.sourceDeviceId === deviceId && link.sourceInterfaceId === interfaceId) ||
          (link.targetDeviceId === deviceId && link.targetInterfaceId === interfaceId)
        ),
    ),
    lastPing: null,
  }
  const updated = getDevice(networkOf(nextState), deviceId)
  if (!updated || !isRouter(updated)) return nextState
  return replaceDevice(nextState, {
    ...updated,
    interfaces: updated.interfaces.filter((iface) => iface.id !== interfaceId),
  })
}

export function selectDevice(state: LabSnapshot, deviceId: string | null): LabSnapshot {
  return { ...state, selectedDeviceId: deviceId, selectedLinkId: deviceId ? null : state.selectedLinkId }
}

export function selectLink(state: LabSnapshot, linkId: string | null): LabSnapshot {
  return { ...state, selectedLinkId: linkId, selectedDeviceId: linkId ? null : state.selectedDeviceId }
}

export function setPingEndpoints(
  state: LabSnapshot,
  sourceId: string | null,
  destinationId: string | null,
): LabSnapshot {
  return {
    ...state,
    pingSourceId: sourceId,
    pingDestinationId: destinationId,
  }
}

function pingDetail(ping: ReturnType<typeof simulatePing>): string {
  if (ping.success) {
    return `${formatHopPath(ping.forward)} · Success`
  }
  if (!ping.forward.success) {
    const drop = ping.forward.hops[ping.forward.hops.length - 1]
    const at = drop ? `Dropped at ${drop.deviceName}` : 'Dropped'
    return `${formatHopPath(ping.forward)} · ${at}. ${ping.forward.failureMessage ?? ''}`.trim()
  }
  const reverse = ping.reverse
  if (reverse && !reverse.success) {
    const drop = reverse.hops[reverse.hops.length - 1]
    const at = drop ? `Return dropped at ${drop.deviceName}` : 'Return path failed'
    return `Forward OK (${formatHopPath(ping.forward)}). ${at}. ${reverse.failureMessage ?? ''}`.trim()
  }
  return 'Ping failed'
}

export function runPing(state: LabSnapshot, sourceId?: string, destinationId?: string): LabSnapshot {
  const source = sourceId ?? state.pingSourceId
  const dest = destinationId ?? state.pingDestinationId
  if (!source || !dest) return state

  const ping = simulatePing(networkOf(state), source, dest)
  const event: TraceEvent = {
    id: `trace-${Date.now()}`,
    time: nowTime(),
    status: ping.success ? 'success' : 'failed',
    title: ping.success
      ? `Ping ${getDevice(networkOf(state), source)?.name} → ${getDevice(networkOf(state), dest)?.name} succeeded`
      : `Ping ${getDevice(networkOf(state), source)?.name} → ${getDevice(networkOf(state), dest)?.name} failed`,
    detail: pingDetail(ping),
    ping,
  }

  return {
    ...state,
    pingSourceId: source,
    pingDestinationId: dest,
    lastPing: ping,
    traces: [event, ...state.traces].slice(0, 12),
  }
}

export function tracePacket(state: LabSnapshot, sourceId: string, destinationId: string): LabSnapshot {
  const result = simulateTrace(networkOf(state), sourceId, destinationId)
  const ping = {
    success: result.success,
    sourceDeviceId: sourceId,
    destinationDeviceId: destinationId,
    forward: result,
    reverse: null,
  }
  const event: TraceEvent = {
    id: `trace-${Date.now()}`,
    time: nowTime(),
    status: result.success ? 'success' : 'failed',
    title: result.success ? 'Packet delivered' : 'Packet dropped',
    detail: `${formatHopPath(result)}${result.failureMessage ? ` · ${result.failureMessage}` : ''}`,
    ping,
  }
  return {
    ...state,
    pingSourceId: sourceId,
    pingDestinationId: destinationId,
    lastPing: ping,
    traces: [event, ...state.traces].slice(0, 12),
  }
}

export function clearSelection(state: LabSnapshot): LabSnapshot {
  return { ...state, selectedDeviceId: null, selectedLinkId: null }
}

export { canConnectDevices }
