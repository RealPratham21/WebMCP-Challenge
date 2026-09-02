export type {
  Device,
  DeviceKind,
  FailureReason,
  HopDecision,
  Link,
  Network,
  NetworkInterface,
  PcDevice,
  PingResult,
  RouterDevice,
  SimulationResult,
  StaticRoute,
} from './types'

export { isPc, isRouter } from './types'
export {
  formatCidr,
  inCidr,
  ipv4ToString,
  isValidIPv4,
  longestPrefixMatch,
  parseCidr,
  parseIPv4,
  sameSubnet,
} from './ipv4'
export { formatHopPath, MAX_HOPS, runPing, tracePacket } from './engine'
export { BROKEN_STATIC_ROUTING, LAB_PRESETS, WORKING_STATIC_ROUTING } from './presets'
