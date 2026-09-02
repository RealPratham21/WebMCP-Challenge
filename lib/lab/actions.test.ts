import { describe, expect, it } from 'vitest'
import {
  addDevice,
  connectDevices,
  disconnectDevices,
  labFromPreset,
  removeDevice,
  renameDevice,
} from './actions'
import { WORKING_STATIC_ROUTING } from '../simulator/presets'
import { isPc, isRouter } from '../simulator/types'

describe('lab actions', () => {
  it('adds devices with generated ids and names', () => {
    let state = labFromPreset(WORKING_STATIC_ROUTING.id)
    state = addDevice(state, 'pc')
    state = addDevice(state, 'router')
    const addedPc = state.devices.find((device) => device.name === 'PC-03')
    const addedRouter = state.devices.find((device) => device.name === 'Router-03')
    expect(addedPc && isPc(addedPc)).toBe(true)
    expect(addedRouter && isRouter(addedRouter)).toBe(true)
    expect(addedPc?.id).not.toBe('pc-1')
  })

  it('connects devices onto real interfaces and disconnects cleanly', () => {
    let state = labFromPreset(WORKING_STATIC_ROUTING.id)
    state = addDevice(state, 'router')
    const extra = state.devices.find((device) => device.name === 'Router-03')!
    const before = extra.kind === 'router' ? extra.interfaces.length : -1
    state = connectDevices(state, 'router-2', extra.id)
    expect(state.links.some((item) => item.targetDeviceId === extra.id || item.sourceDeviceId === extra.id)).toBe(true)
    const connected = state.devices.find((device) => device.id === extra.id)
    expect(connected && isRouter(connected) && connected.interfaces.length).toBeGreaterThan(before)
    const newLink = state.links.find((item) => item.sourceDeviceId === extra.id || item.targetDeviceId === extra.id)!
    state = disconnectDevices(state, newLink.id)
    expect(state.links.some((item) => item.id === newLink.id)).toBe(false)
  })

  it('removes a device and its incident links', () => {
    let state = labFromPreset(WORKING_STATIC_ROUTING.id)
    state = removeDevice(state, 'router-1')
    expect(state.devices.some((device) => device.id === 'router-1')).toBe(false)
    expect(state.links.some((item) => item.sourceDeviceId === 'router-1' || item.targetDeviceId === 'router-1')).toBe(false)
  })

  it('renames a device in the source of truth', () => {
    let state = labFromPreset(WORKING_STATIC_ROUTING.id)
    state = renameDevice(state, 'pc-1', 'Client-A')
    expect(state.devices.find((device) => device.id === 'pc-1')?.name).toBe('Client-A')
  })
})
