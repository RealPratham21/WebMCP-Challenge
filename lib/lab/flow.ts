import type { Edge, Node } from '@xyflow/react'
import type { Device, Link, PingResult } from '../simulator/types'
import { isPc } from '../simulator/types'
import { findLinkBetween } from '../simulator/topology'

export interface DeviceNodeData {
  kind: Device['kind']
  name: string
  subtitle: string
  inPath?: boolean
  pathStatus?: 'success' | 'failed'
  [key: string]: unknown
}

export type LabFlowNode = Node<DeviceNodeData>

function pathDeviceIds(ping: PingResult | null): { ids: Set<string>; status: 'success' | 'failed' } {
  if (!ping) return { ids: new Set(), status: 'success' }
  const trace = ping.success ? ping.forward : (!ping.forward.success ? ping.forward : ping.reverse)
  if (!trace) return { ids: new Set(), status: 'failed' }
  return {
    ids: new Set(trace.hops.map((hop) => hop.deviceId)),
    status: trace.success ? 'success' : 'failed',
  }
}

function pathLinkIds(devices: Device[], links: Link[], ping: PingResult | null): Set<string> {
  const ids = new Set<string>()
  if (!ping) return ids
  const trace = ping.success ? ping.forward : (!ping.forward.success ? ping.forward : ping.reverse)
  if (!trace) return ids
  for (let i = 0; i < trace.hops.length - 1; i += 1) {
    const a = trace.hops[i].deviceId
    const b = trace.hops[i + 1].deviceId
    const link = findLinkBetween({ devices, links }, a, b)
    if (link) ids.add(link.id)
  }
  return ids
}

export function devicesToNodes(
  devices: Device[],
  selectedDeviceId: string | null,
  ping: PingResult | null,
): LabFlowNode[] {
  const path = pathDeviceIds(ping)
  return devices.map((device) => ({
    id: device.id,
    type: 'device',
    position: device.position,
    selected: device.id === selectedDeviceId,
    data: {
      kind: device.kind,
      name: device.name,
      subtitle: isPc(device)
        ? device.iface.ipv4.trim() || 'unconfigured'
        : 'router',
      inPath: path.ids.has(device.id),
      pathStatus: path.ids.has(device.id) ? path.status : undefined,
    },
  }))
}

export function linksToEdges(
  devices: Device[],
  links: Link[],
  selectedLinkId: string | null,
  ping: PingResult | null,
): Edge[] {
  const pathLinks = pathLinkIds(devices, links, ping)
  const status = ping ? (ping.success ? 'success' : 'failed') : undefined
  return links.map((link) => ({
    id: link.id,
    source: link.sourceDeviceId,
    target: link.targetDeviceId,
    animated: true,
    selected: link.id === selectedLinkId,
    className: pathLinks.has(link.id)
      ? status === 'success'
        ? 'path-success'
        : 'path-fail'
      : undefined,
  }))
}
