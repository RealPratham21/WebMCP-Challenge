import type { Device, Link, Network, PcDevice, RouterDevice } from './types'

const POS = {
  pc1: { x: 90, y: 150 },
  r1: { x: 360, y: 150 },
  r2: { x: 650, y: 150 },
  pc2: { x: 930, y: 150 },
} as const

function workingDevices(includeReturnRoute: boolean): Device[] {
  const pc1: PcDevice = {
    id: 'pc-1',
    kind: 'pc',
    name: 'PC-01',
    position: { ...POS.pc1 },
    iface: { id: 'pc-1-eth0', name: 'eth0', ipv4: '192.168.1.10', prefix: 24 },
    defaultGateway: '192.168.1.1',
  }

  const r1: RouterDevice = {
    id: 'router-1',
    kind: 'router',
    name: 'Router-01',
    position: { ...POS.r1 },
    interfaces: [
      { id: 'router-1-eth0', name: 'eth0', ipv4: '192.168.1.1', prefix: 24 },
      { id: 'router-1-eth1', name: 'eth1', ipv4: '10.0.0.1', prefix: 30 },
    ],
    routes: [
      { id: 'router-1-route-1', destinationCidr: '192.168.2.0/24', nextHop: '10.0.0.2' },
    ],
  }

  const r2: RouterDevice = {
    id: 'router-2',
    kind: 'router',
    name: 'Router-02',
    position: { ...POS.r2 },
    interfaces: [
      { id: 'router-2-eth0', name: 'eth0', ipv4: '10.0.0.2', prefix: 30 },
      { id: 'router-2-eth1', name: 'eth1', ipv4: '192.168.2.1', prefix: 24 },
    ],
    routes: includeReturnRoute
      ? [{ id: 'router-2-route-1', destinationCidr: '192.168.1.0/24', nextHop: '10.0.0.1' }]
      : [],
  }

  const pc2: PcDevice = {
    id: 'pc-2',
    kind: 'pc',
    name: 'PC-02',
    position: { ...POS.pc2 },
    iface: { id: 'pc-2-eth0', name: 'eth0', ipv4: '192.168.2.10', prefix: 24 },
    defaultGateway: '192.168.2.1',
  }

  return [pc1, r1, r2, pc2]
}

function chainLinks(): Link[] {
  return [
    {
      id: 'link-1',
      sourceDeviceId: 'pc-1',
      sourceInterfaceId: 'pc-1-eth0',
      targetDeviceId: 'router-1',
      targetInterfaceId: 'router-1-eth0',
    },
    {
      id: 'link-2',
      sourceDeviceId: 'router-1',
      sourceInterfaceId: 'router-1-eth1',
      targetDeviceId: 'router-2',
      targetInterfaceId: 'router-2-eth0',
    },
    {
      id: 'link-3',
      sourceDeviceId: 'router-2',
      sourceInterfaceId: 'router-2-eth1',
      targetDeviceId: 'pc-2',
      targetInterfaceId: 'pc-2-eth0',
    },
  ]
}

export interface LabPreset {
  id: string
  name: string
  description: string
  network: Network
}

export const WORKING_STATIC_ROUTING: LabPreset = {
  id: 'working-static-routing',
  name: 'Working Static Routing Lab',
  description: 'PC1 → R1 → R2 → PC2 with static routes in both directions.',
  network: {
    devices: workingDevices(true),
    links: chainLinks(),
  },
}

export const BROKEN_STATIC_ROUTING: LabPreset = {
  id: 'broken-static-routing',
  name: 'Broken Static Routing Challenge',
  description: 'Same topology as the working lab, but Router-02 is missing the return route to 192.168.1.0/24.',
  network: {
    devices: workingDevices(false),
    links: chainLinks(),
  },
}

export const LAB_PRESETS: LabPreset[] = [WORKING_STATIC_ROUTING, BROKEN_STATIC_ROUTING]

export function cloneNetwork(network: Network): Network {
  return structuredClone(network)
}

export function getPreset(id: string): LabPreset | undefined {
  return LAB_PRESETS.find((preset) => preset.id === id)
}
