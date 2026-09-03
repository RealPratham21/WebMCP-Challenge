import type { LabSnapshot } from '../lab/types'
import { getDevice } from '../simulator/topology'
import {
  missingDeviceError,
  serializeConnectivityResultForAgent,
  serializeDeviceForAgent,
  serializeTopologyForAgent,
} from './serializers'
import type { AgentConnectivityResult, AgentDeviceState, AgentError, AgentTopology } from './types'

export interface LabAccess {
  getSnapshot: () => LabSnapshot
  runPing: (sourceDeviceId: string, destinationDeviceId: string) => void
}

function asId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function getTopology(snapshot: LabSnapshot): AgentTopology {
  return serializeTopologyForAgent(snapshot)
}

export function getDeviceState(snapshot: LabSnapshot, deviceIdRaw: unknown): AgentDeviceState | AgentError {
  const deviceId = asId(deviceIdRaw)
  if (!deviceId) {
    return {
      ok: false,
      error: {
        code: 'INVALID_DEVICE_ID',
        message: "A deviceId string is required. Call get_topology to obtain current device IDs.",
      },
    }
  }
  const device = getDevice({ devices: snapshot.devices, links: snapshot.links }, deviceId)
  if (!device) return missingDeviceError(deviceId)
  return serializeDeviceForAgent(snapshot, device)
}

export function testConnectivity(
  lab: LabAccess,
  sourceIdRaw: unknown,
  destinationIdRaw: unknown,
): AgentConnectivityResult | AgentError {
  const sourceDeviceId = asId(sourceIdRaw)
  const destinationDeviceId = asId(destinationIdRaw)
  const snapshot = lab.getSnapshot()
  const network = { devices: snapshot.devices, links: snapshot.links }

  if (!sourceDeviceId) {
    return {
      ok: false,
      error: {
        code: 'SOURCE_NOT_ENDPOINT',
        message: 'sourceDeviceId is required. Call get_topology to obtain current device IDs.',
      },
    }
  }
  if (!destinationDeviceId) {
    return {
      ok: false,
      error: {
        code: 'DESTINATION_NOT_ENDPOINT',
        message: 'destinationDeviceId is required. Call get_topology to obtain current device IDs.',
      },
    }
  }

  const source = getDevice(network, sourceDeviceId)
  if (!source) {
    return {
      ok: false,
      error: {
        code: 'INVALID_DEVICE_ID',
        message: `No device exists with id '${sourceDeviceId}'. Call get_topology to obtain current device IDs.`,
      },
    }
  }
  const destination = getDevice(network, destinationDeviceId)
  if (!destination) {
    return {
      ok: false,
      error: {
        code: 'INVALID_DEVICE_ID',
        message: `No device exists with id '${destinationDeviceId}'. Call get_topology to obtain current device IDs.`,
      },
    }
  }

  try {
    lab.runPing(sourceDeviceId, destinationDeviceId)
    const next = lab.getSnapshot()
    if (!next.lastPing) {
      return {
        ok: false,
        error: {
          code: 'SIMULATION_FAILED',
          message: 'The simulator did not produce a connectivity result.',
        },
      }
    }
    return serializeConnectivityResultForAgent(next, next.lastPing)
  } catch {
    return {
      ok: false,
      error: {
        code: 'SIMULATION_FAILED',
        message: 'Connectivity test failed unexpectedly. The live lab was not modified.',
      },
    }
  }
}
