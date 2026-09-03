'use client'

import { useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Activity,
  Cable,
  ChevronDown,
  CircleHelp,
  Crosshair,
  Download,
  Gauge,
  LayoutGrid,
  Monitor,
  MousePointer2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  Router as RouterIcon,
  X,
} from 'lucide-react'
import { useLabStore } from '@/lib/lab-store'
import { devicesToNodes, linksToEdges } from '@/lib/lab/flow'
import { deviceFieldErrors, errorFor, pingEndpointLabel } from '@/lib/lab/validation'
import { connectedPeerName, getInterfaces, isInterfaceConnected } from '@/lib/simulator/topology'
import { isPc, isRouter } from '@/lib/simulator/types'
import { formatHopPath } from '@/lib/simulator/engine'
import { parsePrefixInput } from '@/lib/simulator/ipv4'
import { BROKEN_STATIC_ROUTING, WORKING_STATIC_ROUTING } from '@/lib/simulator/presets'
import { DeviceNode } from './device-node'
import { WebMcpBridge } from './webmcp-bridge'

const nodeTypes = { device: DeviceNode }

function statusLabel(status: ReturnType<typeof useLabStore.getState>['lastPing']) {
  if (!status) return 'Simulation idle'
  return status.success ? 'Reachable' : 'Unreachable'
}

function Toolbar() {
  const add = useLabStore((s) => s.addDevice)
  const loadPreset = useLabStore((s) => s.loadPreset)
  const runPing = useLabStore((s) => s.runPing)
  const lastPing = useLabStore((s) => s.lastPing)

  return (
    <header className="lab-toolbar">
      <div className="brand-mark">
        <div className="brand-grid"><span /><span /><span /><span /></div>
        <div>
          <b>NetLab</b>
          <small>NETWORK SIMULATION LAB</small>
        </div>
      </div>
      <div className="toolbar-divider" />
      <div className="toolbar-actions">
        <button className="tool-button active"><MousePointer2 /> Select</button>
        <button className="tool-button" onClick={() => add('pc')}><Plus /> Add device</button>
        <button className="tool-button" onClick={() => loadPreset(WORKING_STATIC_ROUTING.id)}>
          <LayoutGrid /> Working lab
        </button>
        <button className="tool-button" onClick={() => loadPreset(BROKEN_STATIC_ROUTING.id)}>
          <LayoutGrid /> Broken lab
        </button>
        <button className="tool-button" onClick={() => runPing()}><Play /> Run ping</button>
      </div>
      <div className="toolbar-spacer" />
      <span className={`status-pill ${lastPing ? (lastPing.success ? 'ok' : 'bad') : ''}`}>
        <i /> {statusLabel(lastPing)}
      </span>
      <button className="icon-button" aria-label="Settings"><Settings2 /></button>
      <button className="icon-button" aria-label="Help"><CircleHelp /></button>
    </header>
  )
}

function Palette() {
  const add = useLabStore((s) => s.addDevice)
  return (
    <aside className="palette panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">COMPONENTS</span>
          <h2>Device palette</h2>
        </div>
        <button className="icon-button"><ChevronDown /></button>
      </div>
      <p className="muted">Drag devices onto the canvas</p>
      <div className="palette-list">
        <button className="palette-card" onClick={() => add('pc')}>
          <Monitor />
          <span><b>PC</b><small>End device</small></span>
          <Plus />
        </button>
        <button className="palette-card" onClick={() => add('router')}>
          <RouterIcon />
          <span><b>Router</b><small>Layer 3 device</small></span>
          <Plus />
        </button>
      </div>
      <div className="palette-tip">
        <Cable />
        <span><b>Connect devices</b><small>Drag from one port to another</small></span>
      </div>
      <div className="canvas-legend">
        <span className="eyebrow">LEGEND</span>
        <div><i className="legend-dot online" />Online</div>
        <div><i className="legend-dot selected" />Selected</div>
        <div><i className="legend-line" />Link</div>
      </div>
    </aside>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <span className="field-error">{message}</span>
}

function Inspector() {
  const id = useLabStore((s) => s.selectedDeviceId)
  const devices = useLabStore((s) => s.devices)
  const links = useLabStore((s) => s.links)
  const renameDevice = useLabStore((s) => s.renameDevice)
  const configureInterface = useLabStore((s) => s.configureInterface)
  const setDefaultGateway = useLabStore((s) => s.setDefaultGateway)
  const addStaticRoute = useLabStore((s) => s.addStaticRoute)
  const updateStaticRoute = useLabStore((s) => s.updateStaticRoute)
  const removeStaticRoute = useLabStore((s) => s.removeStaticRoute)
  const removeInterface = useLabStore((s) => s.removeInterface)
  const removeDevice = useLabStore((s) => s.removeDevice)
  const selectDevice = useLabStore((s) => s.selectDevice)

  const node = devices.find((device) => device.id === id)
  if (!node) {
    return (
      <aside className="inspector panel">
        <div className="empty-inspector">
          <Crosshair />
          <b>Select a device</b>
          <span>Choose a node on the canvas to inspect its configuration.</span>
        </div>
      </aside>
    )
  }

  const errors = deviceFieldErrors(node, { devices, links })
  const ifaces = getInterfaces(node)

  return (
    <aside className="inspector panel">
      <div className="inspector-top">
        <div>
          <span className="eyebrow">INSPECTOR</span>
          <h2>{node.name}</h2>
        </div>
        <button className="icon-button" onClick={() => selectDevice(null)} aria-label="Close inspector">
          <X />
        </button>
      </div>
      <div className="device-title">
        <div className={`large-device-icon ${node.kind}`}><span /></div>
        <div>
          <b>{node.kind === 'router' ? 'Router' : 'Workstation'}</b>
          <small><i />Online</small>
        </div>
      </div>
      <label className="field-label">
        Device name
        <input value={node.name} onChange={(e) => renameDevice(node.id, e.target.value)} />
      </label>

      {isPc(node) ? (
        <>
          <label className="field-label">
            IPv4 address
            <input
              className={errorFor(errors, `iface:${node.iface.id}:ipv4`) ? 'input-invalid' : undefined}
              value={node.iface.ipv4}
              placeholder="192.168.1.10"
              onChange={(e) => configureInterface(node.id, node.iface.id, { ipv4: e.target.value })}
            />
            <FieldError message={errorFor(errors, `iface:${node.iface.id}:ipv4`)} />
          </label>
          <label className="field-label">
            CIDR prefix
            <input
              className={errorFor(errors, `iface:${node.iface.id}:prefix`) ? 'input-invalid' : undefined}
              value={node.iface.prefix === null ? '' : String(node.iface.prefix)}
              placeholder="24"
              onChange={(e) => {
                const raw = e.target.value.trim()
                if (!raw) {
                  configureInterface(node.id, node.iface.id, { prefix: null })
                  return
                }
                const parsed = parsePrefixInput(raw)
                if (parsed === null) return
                configureInterface(node.id, node.iface.id, { prefix: parsed })
              }}
            />
            <FieldError message={errorFor(errors, `iface:${node.iface.id}:prefix`)} />
          </label>
          <label className="field-label">
            Default gateway
            <input
              className={errorFor(errors, 'gateway') ? 'input-invalid' : undefined}
              value={node.defaultGateway}
              placeholder="192.168.1.1"
              onChange={(e) => setDefaultGateway(node.id, e.target.value)}
            />
            <FieldError message={errorFor(errors, 'gateway')} />
          </label>
        </>
      ) : (
        <>
          <div className="section-label">INTERFACES</div>
          {ifaces.length === 0 && (
            <div className="no-routes">Connect this router to another device to create interfaces.</div>
          )}
          {isRouter(node) && node.interfaces.map((iface) => {
            const peer = connectedPeerName({ devices, links }, node.id, iface.id)
            const connected = isInterfaceConnected({ devices, links }, node.id, iface.id)
            return (
              <div className="interface-block" key={iface.id}>
                <div className="interface-row">
                  <span>{iface.name}</span>
                  <input
                    className={errorFor(errors, `iface:${iface.id}:ipv4`) ? 'input-invalid' : undefined}
                    value={iface.ipv4}
                    placeholder="IPv4"
                    onChange={(e) => configureInterface(node.id, iface.id, { ipv4: e.target.value })}
                  />
                  <input
                    className={`prefix-input ${errorFor(errors, `iface:${iface.id}:prefix`) ? 'input-invalid' : ''}`}
                    value={iface.prefix === null ? '' : String(iface.prefix)}
                    placeholder="/24"
                    onChange={(e) => {
                      const raw = e.target.value.trim()
                      if (!raw) {
                        configureInterface(node.id, iface.id, { prefix: null })
                        return
                      }
                      const parsed = parsePrefixInput(raw)
                      if (parsed === null) return
                      configureInterface(node.id, iface.id, { prefix: parsed })
                    }}
                  />
                  {!connected && (
                    <button onClick={() => removeInterface(node.id, iface.id)} aria-label={`Remove ${iface.name}`}>
                      <Trash2 />
                    </button>
                  )}
                </div>
                <small className="iface-meta">{peer ? `Connected to ${peer}` : 'Not connected'}</small>
                <FieldError message={errorFor(errors, `iface:${iface.id}:ipv4`)} />
                <FieldError message={errorFor(errors, `iface:${iface.id}:prefix`)} />
              </div>
            )
          })}
          <div className="section-label route-label">
            STATIC ROUTES
            <button onClick={() => addStaticRoute(node.id)}><Plus /> Add</button>
          </div>
          {isRouter(node) && node.routes.map((route) => (
            <div className="route-row" key={route.id}>
              <input
                className={errorFor(errors, `route:${route.id}:destination`) ? 'input-invalid' : undefined}
                value={route.destinationCidr}
                placeholder="Destination CIDR"
                onChange={(e) => updateStaticRoute(node.id, route.id, { destinationCidr: e.target.value })}
              />
              <input
                className={errorFor(errors, `route:${route.id}:nextHop`) ? 'input-invalid' : undefined}
                value={route.nextHop}
                placeholder="Next hop"
                onChange={(e) => updateStaticRoute(node.id, route.id, { nextHop: e.target.value })}
              />
              <button onClick={() => removeStaticRoute(node.id, route.id)} aria-label="Remove route">
                <Trash2 />
              </button>
              <FieldError message={errorFor(errors, `route:${route.id}:destination`)} />
              <FieldError message={errorFor(errors, `route:${route.id}:nextHop`)} />
            </div>
          ))}
          {isRouter(node) && node.routes.length === 0 && (
            <div className="no-routes">No static routes configured</div>
          )}
        </>
      )}
      <button className="delete-button" onClick={() => removeDevice(node.id)}>
        <Trash2 /> Delete device
      </button>
    </aside>
  )
}

function TracePanel() {
  const traces = useLabStore((s) => s.traces)
  const devices = useLabStore((s) => s.devices)
  const pingSourceId = useLabStore((s) => s.pingSourceId)
  const pingDestinationId = useLabStore((s) => s.pingDestinationId)
  const setPingEndpoints = useLabStore((s) => s.setPingEndpoints)
  const runPing = useLabStore((s) => s.runPing)
  const lastPing = useLabStore((s) => s.lastPing)

  return (
    <section className="trace-panel">
      <div className="trace-heading">
        <div>
          <span className="eyebrow">ACTIVITY</span>
          <h2>Packet trace</h2>
        </div>
        <span className="trace-count">{traces.length} events</span>
      </div>
      <div className="ping-controls">
        <label>
          Source
          <select
            value={pingSourceId ?? ''}
            onChange={(e) => setPingEndpoints(e.target.value || null, pingDestinationId)}
          >
            <option value="">Select source</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>{pingEndpointLabel(device)}</option>
            ))}
          </select>
        </label>
        <label>
          Destination
          <select
            value={pingDestinationId ?? ''}
            onChange={(e) => setPingEndpoints(pingSourceId, e.target.value || null)}
          >
            <option value="">Select destination</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>{pingEndpointLabel(device)}</option>
            ))}
          </select>
        </label>
        <button className="ping-run" onClick={() => runPing()}>
          <Play /> Run ping
        </button>
      </div>
      {lastPing && (
        <div className={`trace-summary ${lastPing.success ? 'success' : 'failed'}`}>
          <b>{formatHopPath(lastPing.success ? lastPing.forward : (!lastPing.forward.success ? lastPing.forward : lastPing.reverse ?? lastPing.forward))}</b>
          <small>
            {lastPing.success
              ? 'Success — path exists in both directions'
              : lastPing.forward.failureMessage
                ?? lastPing.reverse?.failureMessage
                ?? 'Ping failed'}
          </small>
        </div>
      )}
      {traces.length === 0 ? (
        <div className="trace-empty">
          <Activity />
          <span>No packets captured yet</span>
          <small>Run a ping to see the route trace here.</small>
        </div>
      ) : (
        <div className="trace-list">
          {traces.map((trace) => (
            <div className={`trace-item ${trace.status}`} key={trace.id}>
              <div className="trace-dot" />
              <div>
                <b>{trace.title}</b>
                <small>{trace.detail}</small>
              </div>
              <time>{trace.time}</time>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default function LabWorkspace() {
  const devices = useLabStore((s) => s.devices)
  const links = useLabStore((s) => s.links)
  const selectedDeviceId = useLabStore((s) => s.selectedDeviceId)
  const selectedLinkId = useLabStore((s) => s.selectedLinkId)
  const lastPing = useLabStore((s) => s.lastPing)
  const name = useLabStore((s) => s.name)
  const applyNodeChanges = useLabStore((s) => s.applyNodeChanges)
  const onConnectStore = useLabStore((s) => s.onConnect)
  const selectDevice = useLabStore((s) => s.selectDevice)
  const selectLink = useLabStore((s) => s.selectLink)
  const disconnectDevices = useLabStore((s) => s.disconnectDevices)
  const reset = useLabStore((s) => s.reset)
  const presetId = useLabStore((s) => s.presetId)

  const nodes = useMemo(
    () => devicesToNodes(devices, selectedDeviceId, lastPing),
    [devices, selectedDeviceId, lastPing],
  )
  const edges = useMemo(
    () => linksToEdges(devices, links, selectedLinkId, lastPing),
    [devices, links, selectedLinkId, lastPing],
  )

  const onConnect = useCallback((connection: Connection) => {
    onConnectStore(connection)
  }, [onConnectStore])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const state = useLabStore.getState()
      if (state.selectedLinkId) {
        event.preventDefault()
        state.disconnectDevices(state.selectedLinkId)
        return
      }
      if (state.selectedDeviceId) {
        event.preventDefault()
        state.removeDevice(state.selectedDeviceId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main className="lab-shell">
      <WebMcpBridge />
      <Toolbar />
      <div className="lab-body">
        <Palette />
        <section className="workspace">
          <div className="workspace-top">
            <div>
              <span className="eyebrow">TOPOLOGY / UNSAVED</span>
              <h1>{name}</h1>
            </div>
            <div className="workspace-actions">
              <button onClick={reset}><RotateCcw /> Reset</button>
              <button><Save /> Save</button>
              <button><Download /> Export</button>
            </div>
          </div>
          <div className="flow-wrap">
            {selectedLinkId && (
              <button
                className="edge-delete-action"
                onClick={() => disconnectDevices(selectedLinkId)}
                aria-label="Disconnect selected connection"
              >
                <Trash2 /> Disconnect connection
              </button>
            )}
            <ReactFlow
              key={presetId ?? name}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={applyNodeChanges}
              onConnect={onConnect}
              onNodeClick={(_, node) => selectDevice(node.id)}
              onEdgeClick={(_, edge) => selectLink(edge.id)}
              onPaneClick={() => { selectDevice(null); selectLink(null) }}
              deleteKeyCode={null}
              fitView
            >
              <Background gap={24} size={1} color="var(--grid)" />
              <Controls showInteractive={false} />
              <MiniMap nodeColor="var(--primary)" maskColor="var(--minimap-mask)" />
            </ReactFlow>
            <div className="canvas-badge"><Gauge /> <span>Canvas ready</span></div>
          </div>
          <TracePanel />
        </section>
        <Inspector />
      </div>
    </main>
  )
}
