import type { Device, Link, Network, NetworkInterface, RouterDevice } from './types'
import { isPc, isRouter } from './types'
import { inCidr, parseIPv4, type Cidr } from './ipv4'

export function getDevice(network: Network, id: string): Device | undefined {
  return network.devices.find((device) => device.id === id)
}

export function getInterfaces(device: Device): NetworkInterface[] {
  return isPc(device) ? [device.iface] : device.interfaces
}

export function getInterface(device: Device, interfaceId: string): NetworkInterface | undefined {
  return getInterfaces(device).find((iface) => iface.id === interfaceId)
}

export function otherEndpoint(
  link: Link,
  deviceId: string,
): { deviceId: string; interfaceId: string } | null {
  if (link.sourceDeviceId === deviceId) {
    return { deviceId: link.targetDeviceId, interfaceId: link.targetInterfaceId }
  }
  if (link.targetDeviceId === deviceId) {
    return { deviceId: link.sourceDeviceId, interfaceId: link.sourceInterfaceId }
  }
  return null
}

export function linksOf(network: Network, deviceId: string): Link[] {
  return network.links.filter(
    (link) => link.sourceDeviceId === deviceId || link.targetDeviceId === deviceId,
  )
}

export function findLinkBetween(network: Network, a: string, b: string): Link | undefined {
  return network.links.find(
    (link) =>
      (link.sourceDeviceId === a && link.targetDeviceId === b) ||
      (link.sourceDeviceId === b && link.targetDeviceId === a),
  )
}

export function interfaceLink(
  network: Network,
  deviceId: string,
  interfaceId: string,
): Link | undefined {
  return network.links.find(
    (link) =>
      (link.sourceDeviceId === deviceId && link.sourceInterfaceId === interfaceId) ||
      (link.targetDeviceId === deviceId && link.targetInterfaceId === interfaceId),
  )
}

export function isInterfaceConnected(
  network: Network,
  deviceId: string,
  interfaceId: string,
): boolean {
  return Boolean(interfaceLink(network, deviceId, interfaceId))
}

export interface Neighbor {
  device: Device
  iface: NetworkInterface
  remoteIface: NetworkInterface
  link: Link
}

export function neighborOnInterface(
  network: Network,
  deviceId: string,
  interfaceId: string,
): Neighbor | null {
  const link = interfaceLink(network, deviceId, interfaceId)
  if (!link) return null
  const remote = otherEndpoint(link, deviceId)
  if (!remote) return null
  const device = getDevice(network, remote.deviceId)
  if (!device) return null
  const localDevice = getDevice(network, deviceId)
  if (!localDevice) return null
  const iface = getInterface(localDevice, interfaceId)
  const remoteIface = getInterface(device, remote.interfaceId)
  if (!iface || !remoteIface) return null
  return { device, iface, remoteIface, link }
}

export function deviceOwnsIp(device: Device, ip: number): boolean {
  return getInterfaces(device).some((iface) => parseIPv4(iface.ipv4) === ip)
}

export function interfaceOwnsIp(iface: NetworkInterface, ip: number): boolean {
  return parseIPv4(iface.ipv4) === ip
}

export function getPrimaryIPv4(device: Device): string | null {
  for (const iface of getInterfaces(device)) {
    const value = iface.ipv4.trim()
    if (value) return value
  }
  return null
}

export function nextInterfaceName(device: RouterDevice): string {
  const used = new Set(device.interfaces.map((iface) => iface.name))
  let index = 0
  while (used.has(`eth${index}`)) index += 1
  return `eth${index}`
}

export function unusedInterfaces(network: Network, device: Device): NetworkInterface[] {
  return getInterfaces(device).filter(
    (iface) => !isInterfaceConnected(network, device.id, iface.id),
  )
}

export function canConnectDevices(network: Network, sourceId: string, targetId: string): boolean {
  if (!sourceId || !targetId || sourceId === targetId) return false
  const source = getDevice(network, sourceId)
  const target = getDevice(network, targetId)
  if (!source || !target) return false
  if (findLinkBetween(network, sourceId, targetId)) return false
  if (isPc(source) && linksOf(network, source.id).length > 0) return false
  if (isPc(target) && linksOf(network, target.id).length > 0) return false
  return true
}

export function cidrContainsIp(cidr: Cidr, ip: number): boolean {
  return inCidr(ip, cidr)
}

export function connectedPeerName(network: Network, deviceId: string, interfaceId: string): string | null {
  const neighbor = neighborOnInterface(network, deviceId, interfaceId)
  return neighbor?.device.name ?? null
}

export function isRouterDevice(device: Device): device is RouterDevice {
  return isRouter(device)
}
