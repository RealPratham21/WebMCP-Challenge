export type WebMcpErrorCode =
  | 'INVALID_DEVICE_ID'
  | 'DEVICE_NOT_ROUTER'
  | 'INVALID_CIDR'
  | 'INVALID_NEXT_HOP'
  | 'ROUTE_ALREADY_EXISTS'
  | 'ROUTE_NOT_FOUND'
  | 'SOURCE_NOT_ENDPOINT'
  | 'DESTINATION_NOT_ENDPOINT'
  | 'INVALID_CONFIGURATION'
  | 'SIMULATION_FAILED'

export interface AgentError {
  ok: false
  error: {
    code: WebMcpErrorCode
    message: string
  }
}

export interface AgentPeer {
  deviceId: string
  deviceName: string
}

export interface AgentInterface {
  id: string
  name: string
  ipv4: string
  prefix: number | null
  connectedTo: AgentPeer | null
}

export interface AgentValidationIssue {
  field: string
  message: string
}

export interface AgentStaticRoute {
  id: string
  destination: string
  nextHop: string
}

export interface AgentTopologyDevice {
  id: string
  name: string
  type: 'pc' | 'router'
}

export interface AgentTopologyLink {
  id: string
  sourceDeviceId: string
  sourceDeviceName: string
  sourceInterfaceId: string
  targetDeviceId: string
  targetDeviceName: string
  targetInterfaceId: string
}

export interface AgentTopology {
  ok: true
  labName: string
  devices: AgentTopologyDevice[]
  links: AgentTopologyLink[]
}

export interface AgentPcState {
  ok: true
  id: string
  name: string
  type: 'pc'
  interface: AgentInterface
  defaultGateway: string
  validationIssues: AgentValidationIssue[]
}

export interface AgentRouterState {
  ok: true
  id: string
  name: string
  type: 'router'
  interfaces: AgentInterface[]
  staticRoutes: AgentStaticRoute[]
  validationIssues: AgentValidationIssue[]
}

export type AgentDeviceState = AgentPcState | AgentRouterState

export interface AgentRouteMutationResult {
  ok: true
  deviceId: string
  deviceName: string
  route: AgentStaticRoute
}

export interface AgentHighlightResult {
  ok: true
  deviceId: string
  deviceName: string
}

export interface AgentEndpoint {
  id: string
  name: string
  ipv4: string | null
}

export interface AgentHop {
  deviceId: string
  deviceName: string
  action: string
  nextHop?: string
  matchedRoute?: string
}

export interface AgentFailure {
  direction: 'forward' | 'reverse'
  deviceId?: string
  deviceName?: string
  code: string
  message: string
}

export interface AgentConnectivityResult {
  ok: true
  success: boolean
  source: AgentEndpoint
  destination: AgentEndpoint
  forwardPath: AgentHop[]
  reversePath: AgentHop[] | null
  failure: AgentFailure | null
}

export type AgentToolResult =
  | AgentTopology
  | AgentDeviceState
  | AgentConnectivityResult
  | AgentRouteMutationResult
  | AgentHighlightResult
  | AgentError
