import type { Device, Link, PingResult } from '../simulator/types'

export interface TraceEvent {
  id: string
  time: string
  status: 'success' | 'failed'
  title: string
  detail: string
  ping: PingResult
}

export interface LabSnapshot {
  name: string
  presetId: string | null
  devices: Device[]
  links: Link[]
  selectedDeviceId: string | null
  selectedLinkId: string | null
  pingSourceId: string | null
  pingDestinationId: string | null
  lastPing: PingResult | null
  traces: TraceEvent[]
  idSeq: number
}
