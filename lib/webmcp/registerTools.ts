'use client'

import { labApi } from '@/lib/lab-store'
import { getModelContext } from './context'
import {
  addStaticRoute,
  getDeviceState,
  getTopology,
  highlightDevice,
  removeStaticRoute,
  testConnectivity,
  type LabWriteAccess,
} from './tools'

const emptyInput = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

let activeController: AbortController | null = null

function log(message: string, extra?: unknown) {
  if (extra !== undefined) {
    console.info(`[WebMCP] ${message}`, extra)
    return
  }
  console.info(`[WebMCP] ${message}`)
}

function labAccess(): LabWriteAccess {
  return {
    getSnapshot: () => labApi.getState(),
    runPing: (sourceDeviceId, destinationDeviceId) => labApi.runPing(sourceDeviceId, destinationDeviceId),
    addStaticRoute: (deviceId, route) => labApi.addStaticRoute(deviceId, route),
    removeStaticRoute: (deviceId, routeId) => labApi.removeStaticRoute(deviceId, routeId),
    selectDevice: (deviceId) => labApi.selectDevice(deviceId),
  }
}

export async function registerNetLabTools(): Promise<() => void> {
  const modelContext = getModelContext()
  if (!modelContext) {
    log('unavailable in this browser; simulator continues without agent tools')
    return () => {}
  }

  if (activeController) {
    activeController.abort()
    activeController = null
  }

  const controller = new AbortController()
  activeController = controller
  const options = { signal: controller.signal }
  const lab = labAccess()

  try {
    await modelContext.registerTool(
      {
        name: 'get_topology',
        title: 'Get topology',
        description:
          'Inspect the current NetLab topology. Returns every device and physical connection in the live network lab. Use this first when you need to understand which devices exist and how they are connected.',
        inputSchema: emptyInput,
        annotations: { readOnlyHint: true },
        execute: async () => {
          log('executing get_topology')
          return getTopology(labApi.getState())
        },
      },
      options,
    )

    await modelContext.registerTool(
      {
        name: 'get_device_state',
        title: 'Get device state',
        description:
          'Inspect the current configuration of one device in NetLab. Use this when diagnosing a specific PC or router after discovering its ID through get_topology. deviceId must be the stable internal device ID, not the display name.',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'string',
              description: 'Stable internal device ID from get_topology (for example pc-1 or router-2).',
            },
          },
          required: ['deviceId'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: async (args: { deviceId?: string }) => {
          log('executing get_device_state', { deviceId: args?.deviceId })
          return getDeviceState(labApi.getState(), args?.deviceId)
        },
      },
      options,
    )

    await modelContext.registerTool(
      {
        name: 'test_connectivity',
        title: 'Test connectivity',
        description:
          "Test bidirectional IP connectivity between two endpoint devices using NetLab's deterministic simulator. Returns success/failure, packet path, routing decisions and structured failure information. Use this when determining whether two devices can communicate or diagnosing where connectivity fails. Updates the human packet-trace UI; does not change topology or configuration.",
        inputSchema: {
          type: 'object',
          properties: {
            sourceDeviceId: {
              type: 'string',
              description: 'Stable internal ID of the source device from get_topology.',
            },
            destinationDeviceId: {
              type: 'string',
              description: 'Stable internal ID of the destination device from get_topology.',
            },
          },
          required: ['sourceDeviceId', 'destinationDeviceId'],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: false,
        },
        execute: async (args: { sourceDeviceId?: string; destinationDeviceId?: string }) => {
          log('executing test_connectivity', {
            sourceDeviceId: args?.sourceDeviceId,
            destinationDeviceId: args?.destinationDeviceId,
          })
          return testConnectivity(lab, args?.sourceDeviceId, args?.destinationDeviceId)
        },
      },
      options,
    )

    await modelContext.registerTool(
      {
        name: 'add_static_route',
        title: 'Add static route',
        description:
          'Add one static route to an existing router in the live NetLab workspace. Use this only when the user wants the network configuration changed. Calls the same add-route action as the human inspector. deviceId must be a router ID from get_topology. destination must be a valid IPv4 CIDR. nextHop must be a valid IPv4 address on a connected network.',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'string',
              description: 'Stable internal router ID from get_topology (for example router-2).',
            },
            destination: {
              type: 'string',
              description: 'IPv4 destination CIDR to add, for example 192.168.1.0/24.',
            },
            nextHop: {
              type: 'string',
              description: 'IPv4 next-hop address, for example 10.0.0.1.',
            },
          },
          required: ['deviceId', 'destination', 'nextHop'],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: false,
        },
        execute: async (args: { deviceId?: string; destination?: string; nextHop?: string }) => {
          log('executing add_static_route', {
            deviceId: args?.deviceId,
            destination: args?.destination,
            nextHop: args?.nextHop,
          })
          return addStaticRoute(lab, args?.deviceId, args?.destination, args?.nextHop)
        },
      },
      options,
    )

    await modelContext.registerTool(
      {
        name: 'remove_static_route',
        title: 'Remove static route',
        description:
          'Remove one static route from an existing router in the live NetLab workspace. Use this only when the user wants the network configuration changed. Prefer routeId from get_device_state. If routeId is unknown, provide both destination and nextHop. Calls the same remove-route action as the human inspector.',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'string',
              description: 'Stable internal router ID from get_topology.',
            },
            routeId: {
              type: 'string',
              description: 'Stable route ID from get_device_state. Prefer this when available.',
            },
            destination: {
              type: 'string',
              description: 'IPv4 destination CIDR of the route to remove, used with nextHop when routeId is not provided.',
            },
            nextHop: {
              type: 'string',
              description: 'IPv4 next-hop of the route to remove, used with destination when routeId is not provided.',
            },
          },
          required: ['deviceId'],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: false,
        },
        execute: async (args: {
          deviceId?: string
          routeId?: string
          destination?: string
          nextHop?: string
        }) => {
          log('executing remove_static_route', {
            deviceId: args?.deviceId,
            routeId: args?.routeId,
            destination: args?.destination,
            nextHop: args?.nextHop,
          })
          return removeStaticRoute(lab, args ?? {})
        },
      },
      options,
    )

    await modelContext.registerTool(
      {
        name: 'highlight_device',
        title: 'Highlight device',
        description:
          "Select a device on the shared NetLab canvas and open its inspector so the human can see it. Does not change network configuration. Use this to direct the human's attention to a specific device after diagnosing an issue.",
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'string',
              description: 'Stable internal device ID from get_topology.',
            },
          },
          required: ['deviceId'],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: false,
        },
        execute: async (args: { deviceId?: string }) => {
          log('executing highlight_device', { deviceId: args?.deviceId })
          return highlightDevice(lab, args?.deviceId)
        },
      },
      options,
    )

    if (controller.signal.aborted) return () => {}

    log(
      'registered add_static_route, get_device_state, get_topology, highlight_device, remove_static_route, test_connectivity',
    )
  } catch (error) {
    log('registration failed; simulator continues without agent tools', error)
    controller.abort()
    if (activeController === controller) activeController = null
    return () => {}
  }

  return () => {
    if (activeController === controller) {
      controller.abort()
      activeController = null
      log('unregistered tools')
    }
  }
}
