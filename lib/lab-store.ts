'use client'

import { create } from 'zustand'
import type { Connection, NodeChange } from '@xyflow/react'
import type { DeviceKind } from './simulator/types'
import { WORKING_STATIC_ROUTING } from './simulator/presets'
import type { LabSnapshot } from './lab/types'
import * as actions from './lab/actions'

type LabStore = LabSnapshot & {
  addDevice: (kind: DeviceKind) => void
  removeDevice: (deviceId?: string) => void
  connectDevices: (sourceId: string, targetId: string) => void
  disconnectDevices: (linkId: string) => void
  renameDevice: (deviceId: string, name: string) => void
  configureInterface: (deviceId: string, interfaceId: string, config: actions.InterfaceConfig) => void
  setDefaultGateway: (deviceId: string, gateway: string) => void
  addStaticRoute: (deviceId: string, route?: { destinationCidr: string; nextHop: string }) => void
  updateStaticRoute: (
    deviceId: string,
    routeId: string,
    patch: { destinationCidr?: string; nextHop?: string },
  ) => void
  removeStaticRoute: (deviceId: string, routeId: string) => void
  removeInterface: (deviceId: string, interfaceId: string) => void
  runPing: (sourceId?: string, destinationId?: string) => void
  tracePacket: (sourceId: string, destinationId: string) => void
  selectDevice: (deviceId: string | null) => void
  selectLink: (linkId: string | null) => void
  setPingEndpoints: (sourceId: string | null, destinationId: string | null) => void
  moveDevice: (deviceId: string, position: { x: number; y: number }) => void
  applyNodeChanges: (changes: NodeChange[]) => void
  onConnect: (connection: Connection) => void
  reset: () => void
  loadPreset: (presetId: string) => void
}

const snapshot = (state: LabStore): LabSnapshot => ({
  name: state.name,
  presetId: state.presetId,
  devices: state.devices,
  links: state.links,
  selectedDeviceId: state.selectedDeviceId,
  selectedLinkId: state.selectedLinkId,
  pingSourceId: state.pingSourceId,
  pingDestinationId: state.pingDestinationId,
  lastPing: state.lastPing,
  traces: state.traces,
  idSeq: state.idSeq,
})

export const useLabStore = create<LabStore>((set, get) => ({
  ...actions.labFromPreset(WORKING_STATIC_ROUTING.id),

  addDevice: (kind) => set(actions.addDevice(snapshot(get()), kind)),
  removeDevice: (deviceId) => {
    const state = snapshot(get())
    const id = deviceId ?? state.selectedDeviceId
    if (!id) return
    set(actions.removeDevice(state, id))
  },
  connectDevices: (sourceId, targetId) => set(actions.connectDevices(snapshot(get()), sourceId, targetId)),
  disconnectDevices: (linkId) => set(actions.disconnectDevices(snapshot(get()), linkId)),
  renameDevice: (deviceId, name) => set(actions.renameDevice(snapshot(get()), deviceId, name)),
  configureInterface: (deviceId, interfaceId, config) =>
    set(actions.configureInterface(snapshot(get()), deviceId, interfaceId, config)),
  setDefaultGateway: (deviceId, gateway) => set(actions.setDefaultGateway(snapshot(get()), deviceId, gateway)),
  addStaticRoute: (deviceId, route) => set(actions.addStaticRoute(snapshot(get()), deviceId, route)),
  updateStaticRoute: (deviceId, routeId, patch) =>
    set(actions.updateStaticRoute(snapshot(get()), deviceId, routeId, patch)),
  removeStaticRoute: (deviceId, routeId) => set(actions.removeStaticRoute(snapshot(get()), deviceId, routeId)),
  removeInterface: (deviceId, interfaceId) => set(actions.removeInterface(snapshot(get()), deviceId, interfaceId)),
  runPing: (sourceId, destinationId) => set(actions.runPing(snapshot(get()), sourceId, destinationId)),
  tracePacket: (sourceId, destinationId) => set(actions.tracePacket(snapshot(get()), sourceId, destinationId)),
  selectDevice: (deviceId) => set(actions.selectDevice(snapshot(get()), deviceId)),
  selectLink: (linkId) => set(actions.selectLink(snapshot(get()), linkId)),
  setPingEndpoints: (sourceId, destinationId) =>
    set(actions.setPingEndpoints(snapshot(get()), sourceId, destinationId)),
  moveDevice: (deviceId, position) => set(actions.moveDevice(snapshot(get()), deviceId, position)),
  applyNodeChanges: (changes) => {
    let next = snapshot(get())
    let changed = false
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        next = actions.moveDevice(next, change.id, change.position)
        changed = true
      }
    }
    if (changed) set(next)
  },
  onConnect: (connection) => {
    if (!connection.source || !connection.target) return
    set(actions.connectDevices(snapshot(get()), connection.source, connection.target))
  },
  reset: () => set(actions.emptyLab()),
  loadPreset: (presetId) => set(actions.labFromPreset(presetId)),
}))

export const labApi = {
  addDevice: (kind: DeviceKind) => useLabStore.getState().addDevice(kind),
  removeDevice: (deviceId?: string) => useLabStore.getState().removeDevice(deviceId),
  connectDevices: (sourceId: string, targetId: string) =>
    useLabStore.getState().connectDevices(sourceId, targetId),
  disconnectDevices: (linkId: string) => useLabStore.getState().disconnectDevices(linkId),
  renameDevice: (deviceId: string, name: string) => useLabStore.getState().renameDevice(deviceId, name),
  configureInterface: (
    deviceId: string,
    interfaceId: string,
    config: actions.InterfaceConfig,
  ) => useLabStore.getState().configureInterface(deviceId, interfaceId, config),
  setDefaultGateway: (deviceId: string, gateway: string) =>
    useLabStore.getState().setDefaultGateway(deviceId, gateway),
  addStaticRoute: (deviceId: string, route?: { destinationCidr: string; nextHop: string }) =>
    useLabStore.getState().addStaticRoute(deviceId, route),
  removeStaticRoute: (deviceId: string, routeId: string) =>
    useLabStore.getState().removeStaticRoute(deviceId, routeId),
  runPing: (sourceId?: string, destinationId?: string) =>
    useLabStore.getState().runPing(sourceId, destinationId),
  tracePacket: (sourceId: string, destinationId: string) =>
    useLabStore.getState().tracePacket(sourceId, destinationId),
  loadPreset: (presetId: string) => useLabStore.getState().loadPreset(presetId),
  reset: () => useLabStore.getState().reset(),
  getState: () => snapshot(useLabStore.getState()),
}

export { canConnectDevices } from './lab/actions'
export type { DeviceKind }
