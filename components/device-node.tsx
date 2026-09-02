'use client'

import { Handle, Position } from '@xyflow/react'
import { Monitor, Router } from 'lucide-react'
import type { DeviceNodeData } from '@/lib/lab/flow'

export function DeviceNode({ data, selected }: { data: DeviceNodeData; selected?: boolean }) {
  const isRouter = data.kind === 'router'
  const pathClass = data.inPath ? (data.pathStatus === 'failed' ? 'in-path-fail' : 'in-path') : ''
  return (
    <div className={`device-node ${selected ? 'is-selected' : ''} ${pathClass}`}>
      <Handle type="target" position={Position.Left} />
      <div className="device-icon">{isRouter ? <Router /> : <Monitor />}</div>
      <div className="device-copy">
        <strong>{data.name}</strong>
        <span>{data.subtitle}</span>
      </div>
      <div className="node-status" aria-label="online" />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
