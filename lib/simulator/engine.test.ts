import { describe, expect, it } from 'vitest'
import { formatHopPath, MAX_HOPS, runPing, tracePacket } from './engine'
import { BROKEN_STATIC_ROUTING, cloneNetwork, WORKING_STATIC_ROUTING } from './presets'
import type { Device, Link, Network, PcDevice, RouterDevice } from './types'
import { addStaticRoute, configureInterface, labFromPreset, removeStaticRoute } from '../lab/actions'

function pc(partial: Partial<PcDevice> & Pick<PcDevice, 'id' | 'name'>): PcDevice {
  const iface = partial.iface ?? { id: `${partial.id}-eth0`, name: 'eth0', ipv4: '', prefix: null }
  return {
    kind: 'pc',
    position: { x: 0, y: 0 },
    defaultGateway: '',
    ...partial,
    iface,
  }
}

function router(partial: Partial<RouterDevice> & Pick<RouterDevice, 'id' | 'name'>): RouterDevice {
  return {
    kind: 'router',
    position: { x: 0, y: 0 },
    interfaces: [],
    routes: [],
    ...partial,
  }
}

function link(
  id: string,
  source: Device,
  sourceIface: string,
  target: Device,
  targetIface: string,
): Link {
  return {
    id,
    sourceDeviceId: source.id,
    sourceInterfaceId: sourceIface,
    targetDeviceId: target.id,
    targetInterfaceId: targetIface,
  }
}

function net(devices: Device[], links: Link[]): Network {
  return { devices, links }
}

describe('simulation engine', () => {
  it('reaches a host on the same subnet', () => {
    const a = pc({
      id: 'a',
      name: 'PC-A',
      iface: { id: 'a-eth0', name: 'eth0', ipv4: '192.168.1.10', prefix: 24 },
    })
    const b = pc({
      id: 'b',
      name: 'PC-B',
      iface: { id: 'b-eth0', name: 'eth0', ipv4: '192.168.1.20', prefix: 24 },
    })
    const network = net([a, b], [link('l1', a, 'a-eth0', b, 'b-eth0')])
    const result = runPing(network, 'a', 'b')
    expect(result.success).toBe(true)
    expect(result.forward.hops.map((hop) => hop.deviceName)).toEqual(['PC-A', 'PC-B'])
  })

  it('uses a valid default gateway', () => {
    const endpoint = pc({
      id: 'pc',
      name: 'PC-01',
      iface: { id: 'pc-eth0', name: 'eth0', ipv4: '192.168.1.10', prefix: 24 },
      defaultGateway: '192.168.1.1',
    })
    const gw = router({
      id: 'r',
      name: 'Router-01',
      interfaces: [{ id: 'r-eth0', name: 'eth0', ipv4: '192.168.1.1', prefix: 24 }],
    })
    const network = net([endpoint, gw], [link('l1', endpoint, 'pc-eth0', gw, 'r-eth0')])
    const result = tracePacket(network, 'pc', 'r')
    expect(result.success).toBe(true)
    expect(result.hops.at(-1)?.deviceId).toBe('r')
  })

  it('forwards across two routers with static routes in both directions', () => {
    const network = cloneNetwork(WORKING_STATIC_ROUTING.network)
    const ping = runPing(network, 'pc-1', 'pc-2')
    expect(ping.success).toBe(true)
    expect(formatHopPath(ping.forward)).toBe('PC-01 → Router-01 → Router-02 → PC-02')
    expect(formatHopPath(ping.reverse!)).toBe('PC-02 → Router-02 → Router-01 → PC-01')
  })

  it('fails when the default gateway is missing', () => {
    const endpoint = pc({
      id: 'pc',
      name: 'PC-01',
      iface: { id: 'pc-eth0', name: 'eth0', ipv4: '192.168.1.10', prefix: 24 },
    })
    const gw = router({
      id: 'r',
      name: 'Router-01',
      interfaces: [
        { id: 'r-eth0', name: 'eth0', ipv4: '192.168.1.1', prefix: 24 },
        { id: 'r-eth1', name: 'eth1', ipv4: '10.0.0.1', prefix: 30 },
      ],
    })
    const remote = pc({
      id: 'pc2',
      name: 'PC-02',
      iface: { id: 'pc2-eth0', name: 'eth0', ipv4: '10.0.0.2', prefix: 30 },
    })
    const network = net(
      [endpoint, gw, remote],
      [link('l1', endpoint, 'pc-eth0', gw, 'r-eth0'), link('l2', gw, 'r-eth1', remote, 'pc2-eth0')],
    )
    const result = tracePacket(network, 'pc', 'pc2')
    expect(result.success).toBe(false)
    expect(result.failureReason).toBe('NO_DEFAULT_GATEWAY')
    expect(result.failureDeviceId).toBe('pc')
  })

  it('fails when a forward static route is missing', () => {
    let state = labFromPreset(WORKING_STATIC_ROUTING.id)
    state = removeStaticRoute(state, 'router-1', 'router-1-route-1')
    const result = tracePacket(state, 'pc-1', 'pc-2')
    expect(result.success).toBe(false)
    expect(result.failureReason).toBe('NO_ROUTE')
    expect(result.failureDeviceId).toBe('router-1')
  })

  it('fails ping when the return route is missing', () => {
    const network = cloneNetwork(BROKEN_STATIC_ROUTING.network)
    const ping = runPing(network, 'pc-1', 'pc-2')
    expect(ping.forward.success).toBe(true)
    expect(ping.reverse?.success).toBe(false)
    expect(ping.reverse?.failureReason).toBe('NO_ROUTE')
    expect(ping.reverse?.failureDeviceId).toBe('router-2')
    expect(ping.success).toBe(false)
  })

  it('fails when the next hop is unreachable', () => {
    let state = labFromPreset(WORKING_STATIC_ROUTING.id)
    state = removeStaticRoute(state, 'router-1', 'router-1-route-1')
    state = addStaticRoute(state, 'router-1', { destinationCidr: '192.168.2.0/24', nextHop: '10.0.0.9' })
    const result = tracePacket(state, 'pc-1', 'pc-2')
    expect(result.success).toBe(false)
    expect(result.failureReason).toBe('NEXT_HOP_UNREACHABLE')
  })

  it('rejects malformed addresses instead of crashing', () => {
    const broken = pc({
      id: 'pc',
      name: 'PC-01',
      iface: { id: 'pc-eth0', name: 'eth0', ipv4: 'not-an-ip', prefix: 24 },
    })
    const other = pc({
      id: 'pc2',
      name: 'PC-02',
      iface: { id: 'pc2-eth0', name: 'eth0', ipv4: '192.168.1.20', prefix: 24 },
    })
    const result = tracePacket(net([broken, other], [link('l1', broken, 'pc-eth0', other, 'pc2-eth0')]), 'pc', 'pc2')
    expect(result.success).toBe(false)
    expect(result.failureReason).toBe('INVALID_CONFIGURATION')
  })

  it('uses longest-prefix matching when forwarding', () => {
    const source = pc({
      id: 'pc',
      name: 'PC-01',
      iface: { id: 'pc-eth0', name: 'eth0', ipv4: '192.168.1.10', prefix: 24 },
      defaultGateway: '192.168.1.1',
    })
    const r1 = router({
      id: 'r1',
      name: 'R1',
      interfaces: [
        { id: 'r1-eth0', name: 'eth0', ipv4: '192.168.1.1', prefix: 24 },
        { id: 'r1-eth1', name: 'eth1', ipv4: '10.0.0.1', prefix: 30 },
        { id: 'r1-eth2', name: 'eth2', ipv4: '10.0.1.1', prefix: 30 },
      ],
      routes: [
        { id: 'broad', destinationCidr: '192.168.2.0/24', nextHop: '10.0.0.2' },
        { id: 'specific', destinationCidr: '192.168.2.10/32', nextHop: '10.0.1.2' },
      ],
    })
    const rBroad = router({
      id: 'rb',
      name: 'R-BROAD',
      interfaces: [{ id: 'rb-eth0', name: 'eth0', ipv4: '10.0.0.2', prefix: 30 }],
    })
    const rSpecific = router({
      id: 'rs',
      name: 'R-SPEC',
      interfaces: [
        { id: 'rs-eth0', name: 'eth0', ipv4: '10.0.1.2', prefix: 30 },
        { id: 'rs-eth1', name: 'eth1', ipv4: '192.168.2.1', prefix: 24 },
      ],
    })
    const dest = pc({
      id: 'pc2',
      name: 'PC-02',
      iface: { id: 'pc2-eth0', name: 'eth0', ipv4: '192.168.2.10', prefix: 24 },
      defaultGateway: '192.168.2.1',
    })
    const network = net(
      [source, r1, rBroad, rSpecific, dest],
      [
        link('l1', source, 'pc-eth0', r1, 'r1-eth0'),
        link('l2', r1, 'r1-eth1', rBroad, 'rb-eth0'),
        link('l3', r1, 'r1-eth2', rSpecific, 'rs-eth0'),
        link('l4', rSpecific, 'rs-eth1', dest, 'pc2-eth0'),
      ],
    )
    const result = tracePacket(network, 'pc', 'pc2')
    expect(result.success).toBe(true)
    expect(result.hops.map((hop) => hop.deviceName)).toContain('R-SPEC')
    expect(result.hops.map((hop) => hop.deviceName)).not.toContain('R-BROAD')
  })

  it('fails when the topology is disconnected', () => {
    const a = pc({
      id: 'a',
      name: 'PC-A',
      iface: { id: 'a-eth0', name: 'eth0', ipv4: '192.168.1.10', prefix: 24 },
      defaultGateway: '192.168.1.1',
    })
    const b = pc({
      id: 'b',
      name: 'PC-B',
      iface: { id: 'b-eth0', name: 'eth0', ipv4: '192.168.2.10', prefix: 24 },
      defaultGateway: '192.168.2.1',
    })
    const result = runPing(net([a, b], []), 'a', 'b')
    expect(result.success).toBe(false)
    expect(result.forward.failureReason).toBe('INVALID_GATEWAY')

    const local = pc({
      id: 'c',
      name: 'PC-C',
      iface: { id: 'c-eth0', name: 'eth0', ipv4: '192.168.1.20', prefix: 24 },
    })
    const sameSubnet = tracePacket(net([a, local], []), 'a', 'c')
    expect(sameSubnet.failureReason).toBe('DESTINATION_UNREACHABLE')
  })

  it('detects routing loops', () => {
    const a = pc({
      id: 'pc1',
      name: 'PC-01',
      iface: { id: 'pc1-eth0', name: 'eth0', ipv4: '192.168.1.10', prefix: 24 },
      defaultGateway: '192.168.1.1',
    })
    const r1 = router({
      id: 'r1',
      name: 'R1',
      interfaces: [
        { id: 'r1-eth0', name: 'eth0', ipv4: '192.168.1.1', prefix: 24 },
        { id: 'r1-eth1', name: 'eth1', ipv4: '10.0.0.1', prefix: 30 },
      ],
      routes: [{ id: 'r1r', destinationCidr: '192.168.2.0/24', nextHop: '10.0.0.2' }],
    })
    const r2 = router({
      id: 'r2',
      name: 'R2',
      interfaces: [{ id: 'r2-eth0', name: 'eth0', ipv4: '10.0.0.2', prefix: 30 }],
      routes: [{ id: 'r2r', destinationCidr: '192.168.2.0/24', nextHop: '10.0.0.1' }],
    })
    const dest = pc({
      id: 'pc2',
      name: 'PC-02',
      iface: { id: 'pc2-eth0', name: 'eth0', ipv4: '192.168.2.10', prefix: 24 },
    })
    const network = net(
      [a, r1, r2, dest],
      [link('l1', a, 'pc1-eth0', r1, 'r1-eth0'), link('l2', r1, 'r1-eth1', r2, 'r2-eth0')],
    )
    const result = tracePacket(network, 'pc1', 'pc2')
    expect(result.success).toBe(false)
    expect(result.failureReason).toBe('ROUTING_LOOP')
  })

  it('enforces a hop limit on a long forwarding chain', () => {
    const devices: Device[] = []
    const links: Link[] = []
    const hops = MAX_HOPS + 3
    for (let i = 0; i < hops; i += 1) {
      const leftIp = i === 0 ? '192.168.0.1' : `10.0.${i - 1}.2`
      const rightIp = `10.0.${i}.1`
      devices.push(
        router({
          id: `r${i}`,
          name: `R${i}`,
          interfaces: [
            { id: `r${i}-left`, name: 'eth0', ipv4: leftIp, prefix: 30 },
            { id: `r${i}-right`, name: 'eth1', ipv4: rightIp, prefix: 30 },
          ],
          routes: [{ id: `r${i}-route`, destinationCidr: '192.168.9.0/24', nextHop: `10.0.${i}.2` }],
        }),
      )
      if (i > 0) {
        links.push({
          id: `l${i}`,
          sourceDeviceId: `r${i - 1}`,
          sourceInterfaceId: `r${i - 1}-right`,
          targetDeviceId: `r${i}`,
          targetInterfaceId: `r${i}-left`,
        })
      }
    }
    const dest = pc({
      id: 'dest',
      name: 'DEST',
      iface: { id: 'dest-eth0', name: 'eth0', ipv4: '192.168.9.1', prefix: 24 },
    })
    devices.push(dest)
    const result = tracePacket(net(devices, links), 'r0', 'dest')
    expect(result.success).toBe(false)
    expect(result.failureReason).toBe('ROUTING_LOOP')
    expect(result.failureMessage).toMatch(/hop limit/i)
  })

  it('becomes reachable after the missing return route is added', () => {
    let state = labFromPreset(BROKEN_STATIC_ROUTING.id)
    expect(runPing(state, 'pc-1', 'pc-2').success).toBe(false)
    state = addStaticRoute(state, 'router-2', { destinationCidr: '192.168.1.0/24', nextHop: '10.0.0.1' })
    expect(runPing(state, 'pc-1', 'pc-2').success).toBe(true)
  })

  it('fails when an interface is unconfigured', () => {
    let state = labFromPreset(WORKING_STATIC_ROUTING.id)
    state = configureInterface(state, 'pc-1', 'pc-1-eth0', { ipv4: '', prefix: null })
    const result = tracePacket(state, 'pc-1', 'pc-2')
    expect(result.success).toBe(false)
    expect(result.failureReason).toBe('INTERFACE_UNCONFIGURED')
  })
})
