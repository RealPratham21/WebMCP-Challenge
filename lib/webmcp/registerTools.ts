'use client'

import { labApi } from '@/lib/lab-store'
import { getModelContext } from './context'
import { getDeviceState, getTopology, testConnectivity } from './tools'

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
        return testConnectivity(
          {
            getSnapshot: () => labApi.getState(),
            runPing: (sourceDeviceId, destinationDeviceId) => labApi.runPing(sourceDeviceId, destinationDeviceId),
          },
          args?.sourceDeviceId,
          args?.destinationDeviceId,
        )
      },
    },
    options,
  )

  if (controller.signal.aborted) return () => {}

  log('registered get_topology, get_device_state, test_connectivity')
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
