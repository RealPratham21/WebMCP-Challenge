import { describe, expect, it } from 'vitest'
import { addDevice, addStaticRoute, configureInterface, labFromPreset, removeDevice, runPing } from '../lab/actions'
import { BROKEN_STATIC_ROUTING, WORKING_STATIC_ROUTING } from '../simulator/presets'
import { serializeDeviceForAgent, serializeTopologyForAgent } from './serializers'
import { getDeviceState, getTopology, testConnectivity, type LabAccess } from './tools'

function memoryLab(initial = labFromPreset(WORKING_STATIC_ROUTING.id)): LabAccess & { snapshot: () => ReturnType<typeof labFromPreset> } {
  let state = initial
  return {
    getSnapshot: () => state,
    runPing: (source, dest) => {
      state = runPing(state, source, dest)
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
    const lab: LabAccess = {
      getSnapshot: () => state,
      runPing: (source, dest) => {
        state = runPing(state, source, dest)
      },
    }
    expect((testConnectivity(lab, 'pc-1', 'pc-2') as { success?: boolean }).success).toBe(false)
    state = addStaticRoute(state, 'router-2', { destinationCidr: '192.168.1.0/24', nextHop: '10.0.0.1' })
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
