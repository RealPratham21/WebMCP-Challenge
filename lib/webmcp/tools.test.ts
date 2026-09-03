import { describe, expect, it } from 'vitest'
import {
  addDevice,
  addStaticRoute as addStaticRouteAction,
  configureInterface,
  labFromPreset,
  removeDevice,
  removeStaticRoute as removeStaticRouteAction,
  runPing,
  selectDevice as selectDeviceAction,
} from '../lab/actions'
import { BROKEN_STATIC_ROUTING, WORKING_STATIC_ROUTING } from '../simulator/presets'
import { isRouter } from '../simulator/types'
import { serializeDeviceForAgent, serializeTopologyForAgent } from './serializers'
import {
  addStaticRoute,
  getDeviceState,
  getTopology,
  highlightDevice,
  removeStaticRoute,
  testConnectivity,
  type LabWriteAccess,
} from './tools'

function memoryLab(initial = labFromPreset(WORKING_STATIC_ROUTING.id)): LabWriteAccess & {
  snapshot: () => ReturnType<typeof labFromPreset>
} {
  let state = initial
  return {
    getSnapshot: () => state,
    runPing: (source, dest) => {
      state = runPing(state, source, dest)
    },
    addStaticRoute: (deviceId, route) => {
      state = addStaticRouteAction(state, deviceId, route)
    },
    removeStaticRoute: (deviceId, routeId) => {
      state = removeStaticRouteAction(state, deviceId, routeId)
    },
    selectDevice: (deviceId) => {
      state = selectDeviceAction(state, deviceId)
    },
    snapshot: () => state,
  }
}

describe('WebMCP serializers', () => {
  it('serializes the live topology without framework fields', () => {
    const snapshot = labFromPreset(WORKING_STATIC_ROUTING.id)
    const result = serializeTopologyForAgent(snapshot)
    expect(result.ok).toBe(true)
    expect(result.labName).toBe('Working Static Routing Lab')
    expect(result.devices.map((device) => device.id)).toEqual(['pc-1', 'router-1', 'router-2', 'pc-2'])
    expect(result.devices.map((device) => device.type)).toEqual(['pc', 'router', 'router', 'pc'])
    expect(result.links).toHaveLength(3)
    expect(result.links[0]).toMatchObject({
      sourceDeviceId: 'pc-1',
      sourceDeviceName: 'PC-01',
      targetDeviceId: 'router-1',
      targetDeviceName: 'Router-01',
    })
    expect(JSON.stringify(result)).not.toContain('position')
    expect(JSON.stringify(result)).not.toContain('selectedDeviceId')
  })

  it('reflects human topology edits on the next serialization', () => {
    let snapshot = labFromPreset(WORKING_STATIC_ROUTING.id)
    snapshot = addDevice(snapshot, 'pc')
    snapshot = removeDevice(snapshot, 'pc-2')
    const result = getTopology(snapshot)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.devices.some((device) => device.id === 'pc-2')).toBe(false)
    expect(result.devices.some((device) => device.name === 'PC-03')).toBe(true)
    expect(result.links.some((link) => link.sourceDeviceId === 'pc-2' || link.targetDeviceId === 'pc-2')).toBe(false)
  })

  it('serializes PC and router configuration from domain state', () => {
    const snapshot = labFromPreset(WORKING_STATIC_ROUTING.id)
    const pc = serializeDeviceForAgent(snapshot, snapshot.devices[0])
    const router = serializeDeviceForAgent(snapshot, snapshot.devices[1])
    expect(pc).toMatchObject({
      ok: true,
      type: 'pc',
      defaultGateway: '192.168.1.1',
      interface: { ipv4: '192.168.1.10', prefix: 24, connectedTo: { deviceId: 'router-1', deviceName: 'Router-01' } },
    })
    expect(router).toMatchObject({
      ok: true,
      type: 'router',
      staticRoutes: [{ destination: '192.168.2.0/24', nextHop: '10.0.0.2' }],
    })
    if (router.ok && router.type === 'router') {
      expect(router.interfaces).toHaveLength(2)
      expect(router.staticRoutes[0]?.id).toBe('router-1-route-1')
    }
  })

  it('returns latest config after a human edit', () => {
    let snapshot = labFromPreset(WORKING_STATIC_ROUTING.id)
    snapshot = configureInterface(snapshot, 'pc-1', 'pc-1-eth0', { ipv4: '192.168.1.55' })
    const result = getDeviceState(snapshot, 'pc-1')
    expect(result.ok).toBe(true)
    if (result.ok && result.type === 'pc') {
      expect(result.interface.ipv4).toBe('192.168.1.55')
    }
  })

  it('returns an agent-readable error for an unknown device id', () => {
    const result = getDeviceState(labFromPreset(WORKING_STATIC_ROUTING.id), 'router-9')
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_DEVICE_ID',
        message: "No device exists with id 'router-9'. Call get_topology to obtain current device IDs.",
      },
    })
  })
})

describe('WebMCP connectivity adapter', () => {
  it('uses the real simulator for a successful working lab ping', () => {
    const lab = memoryLab(labFromPreset(WORKING_STATIC_ROUTING.id))
    const result = testConnectivity(lab, 'pc-1', 'pc-2')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.success).toBe(true)
    expect(result.forwardPath.map((hop) => hop.deviceName)).toEqual([
      'PC-01',
      'Router-01',
      'Router-02',
      'PC-02',
    ])
    expect(result.failure).toBeNull()
    expect(lab.getSnapshot().lastPing?.success).toBe(true)
  })

  it('returns the real broken-lab failure from the simulator', () => {
    const lab = memoryLab(labFromPreset(BROKEN_STATIC_ROUTING.id))
    const result = testConnectivity(lab, 'pc-1', 'pc-2')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.success).toBe(false)
    expect(result.failure).toMatchObject({
      direction: 'reverse',
      deviceId: 'router-2',
      deviceName: 'Router-02',
      code: 'NO_ROUTE',
    })
  })

  it('changes to success after the human repairs the return route', () => {
    let state = labFromPreset(BROKEN_STATIC_ROUTING.id)
    const lab = {
      getSnapshot: () => state,
      runPing: (source: string, dest: string) => {
        state = runPing(state, source, dest)
      },
      addStaticRoute: (deviceId: string, route: { destinationCidr: string; nextHop: string }) => {
        state = addStaticRouteAction(state, deviceId, route)
      },
      removeStaticRoute: (deviceId: string, routeId: string) => {
        state = removeStaticRouteAction(state, deviceId, routeId)
      },
      selectDevice: (deviceId: string) => {
        state = selectDeviceAction(state, deviceId)
      },
    }
    expect((testConnectivity(lab, 'pc-1', 'pc-2') as { success?: boolean }).success).toBe(false)
    state = addStaticRouteAction(state, 'router-2', { destinationCidr: '192.168.1.0/24', nextHop: '10.0.0.1' })
    const repaired = testConnectivity(lab, 'pc-1', 'pc-2')
    expect(repaired.ok).toBe(true)
    if (!repaired.ok) return
    expect(repaired.success).toBe(true)
    expect(repaired.failure).toBeNull()
  })

  it('does not run the simulator for an invalid source id', () => {
    const lab = memoryLab()
    const result = testConnectivity(lab, 'router-9', 'pc-2')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('INVALID_DEVICE_ID')
    expect(lab.getSnapshot().lastPing).toBeNull()
  })
})

describe('WebMCP static-route and highlight adapters', () => {
  it('adds the missing return route through the same lab action as the UI', () => {
    const lab = memoryLab(labFromPreset(BROKEN_STATIC_ROUTING.id))
    const result = addStaticRoute(lab, 'router-2', '192.168.1.0/24', '10.0.0.1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({
      deviceId: 'router-2',
      deviceName: 'Router-02',
      route: { destination: '192.168.1.0/24', nextHop: '10.0.0.1' },
    })
    expect(result.route.id).toMatch(/^router-2-route-/)
    const router = lab.getSnapshot().devices.find((device) => device.id === 'router-2')
    expect(router && isRouter(router) && router.routes).toEqual([
      { id: result.route.id, destinationCidr: '192.168.1.0/24', nextHop: '10.0.0.1' },
    ])
    expect(lab.getSnapshot().selectedDeviceId).toBe('router-2')
  })

  it('rejects a static route on a PC', () => {
    const lab = memoryLab()
    const result = addStaticRoute(lab, 'pc-1', '192.168.2.0/24', '192.168.1.1')
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'DEVICE_NOT_ROUTER' },
    })
    expect(lab.getSnapshot().devices.find((device) => device.id === 'pc-1')).toMatchObject({ kind: 'pc' })
  })

  it('rejects invalid CIDR and next-hop values without mutating the lab', () => {
    const lab = memoryLab(labFromPreset(BROKEN_STATIC_ROUTING.id))
    const before = lab.snapshot()
    expect(addStaticRoute(lab, 'router-2', '192.168.1.0', '10.0.0.1')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CIDR' },
    })
    expect(addStaticRoute(lab, 'router-2', '192.168.1.0/24', '10.0.0')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_NEXT_HOP' },
    })
    expect(addStaticRoute(lab, 'router-2', '192.168.1.0/24', '8.8.8.8')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_NEXT_HOP' },
    })
    expect(lab.snapshot().devices).toEqual(before.devices)
  })

  it('rejects a duplicate route', () => {
    const lab = memoryLab()
    const result = addStaticRoute(lab, 'router-1', '192.168.2.0/24', '10.0.0.2')
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'ROUTE_ALREADY_EXISTS' },
    })
  })

  it('removes a route by stable route id', () => {
    const lab = memoryLab()
    const result = removeStaticRoute(lab, { deviceId: 'router-1', routeId: 'router-1-route-1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.route).toEqual({
      id: 'router-1-route-1',
      destination: '192.168.2.0/24',
      nextHop: '10.0.0.2',
    })
    const router = lab.getSnapshot().devices.find((device) => device.id === 'router-1')
    expect(router && isRouter(router) && router.routes).toEqual([])
  })

  it('removes a route by destination and next hop when route id is omitted', () => {
    const lab = memoryLab()
    const result = removeStaticRoute(lab, {
      deviceId: 'router-1',
      destination: '192.168.2.0/24',
      nextHop: '10.0.0.2',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.route.id).toBe('router-1-route-1')
    const router = lab.getSnapshot().devices.find((device) => device.id === 'router-1')
    expect(router && isRouter(router) && router.routes).toEqual([])
  })

  it('returns ROUTE_NOT_FOUND for a missing route', () => {
    const lab = memoryLab(labFromPreset(BROKEN_STATIC_ROUTING.id))
    expect(removeStaticRoute(lab, { deviceId: 'router-2', routeId: 'missing-route' })).toMatchObject({
      ok: false,
      error: { code: 'ROUTE_NOT_FOUND' },
    })
    expect(
      removeStaticRoute(lab, { deviceId: 'router-2', destination: '192.168.1.0/24', nextHop: '10.0.0.1' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ROUTE_NOT_FOUND' },
    })
  })

  it('highlights an existing device using the shared selection action', () => {
    const lab = memoryLab()
    const result = highlightDevice(lab, 'router-2')
    expect(result).toEqual({
      ok: true,
      deviceId: 'router-2',
      deviceName: 'Router-02',
    })
    expect(lab.getSnapshot().selectedDeviceId).toBe('router-2')
    expect(lab.getSnapshot().lastPing).toBeNull()
  })

  it('rejects highlight for an unknown device', () => {
    const lab = memoryLab()
    expect(highlightDevice(lab, 'router-9')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_DEVICE_ID' },
    })
    expect(lab.getSnapshot().selectedDeviceId).not.toBe('router-9')
  })

  it('repairs and rebreaks the broken lab without a reload', () => {
    const lab = memoryLab(labFromPreset(BROKEN_STATIC_ROUTING.id))
    const failed = testConnectivity(lab, 'pc-1', 'pc-2')
    expect(failed.ok).toBe(true)
    if (!failed.ok) return
    expect(failed.success).toBe(false)
    expect(failed.failure?.code).toBe('NO_ROUTE')

    const added = addStaticRoute(lab, 'router-2', '192.168.1.0/24', '10.0.0.1')
    expect(added.ok).toBe(true)
    if (!added.ok) return

    const repaired = testConnectivity(lab, 'pc-1', 'pc-2')
    expect(repaired.ok).toBe(true)
    if (!repaired.ok) return
    expect(repaired.success).toBe(true)

    const removed = removeStaticRoute(lab, { deviceId: 'router-2', routeId: added.route.id })
    expect(removed.ok).toBe(true)

    const brokenAgain = testConnectivity(lab, 'pc-1', 'pc-2')
    expect(brokenAgain.ok).toBe(true)
    if (!brokenAgain.ok) return
    expect(brokenAgain.success).toBe(false)
    expect(brokenAgain.failure).toMatchObject({
      direction: 'reverse',
      deviceId: 'router-2',
      code: 'NO_ROUTE',
    })
  })
})
