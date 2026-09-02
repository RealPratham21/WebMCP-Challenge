export type DeviceKind = 'pc' | 'router'

export type FailureReason =
  | 'NO_DEFAULT_GATEWAY'
  | 'INVALID_GATEWAY'
  | 'NO_ROUTE'
  | 'NEXT_HOP_UNREACHABLE'
  | 'INTERFACE_UNCONFIGURED'
  | 'DESTINATION_UNREACHABLE'
  | 'ROUTING_LOOP'
  | 'INVALID_CONFIGURATION'

export type HopAction = 'source' | 'forward' | 'deliver' | 'drop'

export interface Vec2 {
  x: number
  y: number
}

export interface NetworkInterface {
  id: string
  name: string
  ipv4: string
  prefix: number | null
}

export interface StaticRoute {
  id: string
  destinationCidr: string
  nextHop: string
}

export interface PcDevice {
  id: string
  kind: 'pc'
  name: string
  position: Vec2
  iface: NetworkInterface
  defaultGateway: string
}

export interface RouterDevice {
  id: string
  kind: 'router'
  name: string
  position: Vec2
  interfaces: NetworkInterface[]
  routes: StaticRoute[]
}

export type Device = PcDevice | RouterDevice

export interface Link {
  id: string
  sourceDeviceId: string
  sourceInterfaceId: string
  targetDeviceId: string
  targetInterfaceId: string
}

export interface Network {
  devices: Device[]
  links: Link[]
}

export interface HopDecision {
  deviceId: string
  deviceName: string
  action: HopAction
  incomingInterfaceId?: string
  outgoingInterfaceId?: string
  nextHop?: string
  matchedRoute?: string
  reason?: string
}

export interface SimulationResult {
  success: boolean
  sourceDeviceId: string
  destinationDeviceId: string
  sourceIp: string
  destinationIp: string
  hops: HopDecision[]
  failureDeviceId?: string
  failureReason?: FailureReason
  failureMessage?: string
}

export interface PingResult {
  success: boolean
  sourceDeviceId: string
  destinationDeviceId: string
  forward: SimulationResult
  reverse: SimulationResult | null
}

export function isPc(device: Device): device is PcDevice {
  return device.kind === 'pc'
}

export function isRouter(device: Device): device is RouterDevice {
  return device.kind === 'router'
}
