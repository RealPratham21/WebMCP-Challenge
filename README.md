# NetLab

Browser-based IPv4 network simulation lab for the WebMCP Challenge.

NetLab lets a human build a small topology of PCs and routers, configure addresses and static routes, and run deterministic ping/trace simulation against that live lab state. The same application actions are designed so a compatible AI agent can later inspect and interact with the exact same simulator through WebMCP.

This repository currently ships the **human lab + simulation engine**. WebMCP is the next phase, not this one.

## Motivation

Most “network labs in the browser” are either visual mockups or full packet emulators. NetLab sits in between: a focused Layer-3 logic simulator that is small enough to reason about, deterministic enough to test, and structured enough that an external agent can later share the human’s live topology instead of inventing its own.

The long-term idea is simple: if a human and an AI agent look at the same lab, they should see the same devices, the same routes, and the same ping result.

## What currently works

- React Flow topology canvas for PCs, routers, and links
- Device inspector for names, IPv4/CIDR, default gateways, and static routes
- Client-side lab state (Zustand) as the single source of truth
- Deterministic IPv4 / CIDR / static-routing simulation engine
- Ping with bidirectional reachability checks
- Packet traces with hop-by-hop forwarding decisions
- Two real presets: a working static-routing lab and a broken challenge lab
- Application actions (`addDevice`, `runPing`, `configureInterface`, …) reusable by the UI and, later, by WebMCP tools

## Screenshots

Add screenshots of the canvas, inspector, and packet trace here after recording a local session.

- Topology canvas with PC → Router → Router → PC
- Inspector showing interface and static-route configuration
- Packet trace for a successful ping and a dropped return path

## Supported networking scope

NetLab is a **logical Layer-3 simulator**. It supports:

- PCs and routers
- Direct physical links
- IPv4 addresses and CIDR prefixes
- PC default gateways
- Directly connected router networks
- Static routes with longest-prefix matching
- Logical packet forwarding
- Ping reachability
- Packet tracing

It does **not** implement:

- IPv6, ARP, DHCP, NAT, VLANs, or switches
- OSPF, BGP, EIGRP, or Cisco IOS
- Sockets, virtual machines, or real network packets
- A backend, embedded chatbot, or WebMCP server

If ping succeeds, it is because the engine found a valid forwarding path in **both** directions. The model never decides that.

## Architecture

```
UI (React Flow + inspector + trace)
        │
        ▼
Application actions  (lib/lab/actions.ts, lib/lab-store.ts → labApi)
        │
        ▼
Lab snapshot         (devices, links, routes, selection, last ping)
        │
        ▼
Pure simulator       (lib/simulator)
                     ipv4.ts + topology.ts + engine.ts
```

- **Domain types** describe PCs, routers, interfaces, links, static routes, and simulation results.
- **Lab state** lives in one Zustand store. React Flow nodes/edges are derived from that state, not stored as a second network copy.
- **Simulation** is pure TypeScript. Given the same snapshot, `tracePacket()` and `runPing()` always return the same result.
- **Application actions** such as `addDevice()`, `connectDevices()`, `configureInterface()`, `addStaticRoute()`, and `runPing()` are the operations both the UI and future WebMCP tools should call.

## Simulator design

`tracePacket(sourceDeviceId, destinationDeviceId)` walks a logical packet toward the destination IPv4 address.

On a PC:

1. If the destination is on the local subnet, deliver over the connected link when that neighbor owns the address.
2. Otherwise use the configured default gateway.
3. The gateway must be a valid on-link address present on the connected neighbor.

On a router:

1. Deliver if the destination is one of the router’s own addresses.
2. Otherwise forward on a directly connected network.
3. Otherwise select a static route with longest-prefix matching, resolve the next hop on a connected interface, and forward over that link.

The engine stops on obvious routing loops or a hop limit, and returns structured failures:

`NO_DEFAULT_GATEWAY`, `INVALID_GATEWAY`, `NO_ROUTE`, `NEXT_HOP_UNREACHABLE`, `INTERFACE_UNCONFIGURED`, `DESTINATION_UNREACHABLE`, `ROUTING_LOOP`, `INVALID_CONFIGURATION`.

`runPing()` traces forward and reverse. Ping succeeds only when both traces succeed.

## Tech stack

- Next.js 16 and React 19
- TypeScript
- React Flow (`@xyflow/react`)
- Zustand
- Tailwind CSS
- Vitest for the domain/simulator tests

No backend is required. Everything runs in the browser.

## Local setup

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
pnpm build
pnpm start
```

runs the production build.

## How to use

1. Load **Working lab** or **Broken lab**, or start from a blank canvas with **Reset**.
2. Add PCs and routers from the palette.
3. Drag from one device port to another to create a link. Router interfaces are created from those connections.
4. Select a device and configure it in the inspector.
   - PC: name, IPv4 address, CIDR prefix, default gateway
   - Router: per-interface IPv4/CIDR and static routes
5. Choose a source and destination in the packet trace panel, then click **Run ping**.
6. The trace shows the hop path. The canvas highlights the devices and links used by the latest simulation.

Invalid IPv4, CIDR, gateway, or next-hop values show inspector errors. The simulator does not invent missing configuration.

## Sample topologies

### Working Static Routing Lab

```
PC-01 (192.168.1.10/24, gw 192.168.1.1)
   │
Router-01
   eth0 192.168.1.1/24
   eth1 10.0.0.1/30
   static: 192.168.2.0/24 via 10.0.0.2
   │
Router-02
   eth0 10.0.0.2/30
   eth1 192.168.2.1/24
   static: 192.168.1.0/24 via 10.0.0.1
   │
PC-02 (192.168.2.10/24, gw 192.168.2.1)
```

Ping PC-01 → PC-02 succeeds in both directions:

`PC-01 → Router-01 → Router-02 → PC-02`

### Broken Static Routing Challenge

Same devices and addresses, but Router-02 has **no** return route to `192.168.1.0/24`. The forward path can still work; the return path fails at Router-02 with `NO_ROUTE`. Ping therefore fails. Adding the missing static route makes the lab reachable — the failure comes from the engine, not from a hard-coded “failed” result.

## Project structure

```
app/                         Next.js app shell and styles
components/lab-workspace.tsx Human lab UI
components/device-node.tsx   Canvas device node
lib/lab-store.ts             Zustand store + labApi action wrappers
lib/lab/actions.ts           Pure lab mutations and runPing/tracePacket
lib/lab/flow.ts              Domain → React Flow mapping
lib/lab/validation.ts        Inspector validation
lib/simulator/types.ts       Domain model
lib/simulator/ipv4.ts        IPv4/CIDR utilities
lib/simulator/topology.ts    Link/interface helpers
lib/simulator/engine.ts      Packet tracing and ping
lib/simulator/presets.ts     Working and broken labs
```

## Testing

```bash
pnpm test
```

Tests cover the pure simulator and lab actions, including:

- Same-subnet reachability
- Valid default gateway
- Two-router static routing
- Missing default gateway
- Missing forward route
- Missing return route
- Unreachable next hop
- Malformed addresses
- Longest-prefix route selection
- Disconnected topology
- Routing loops and hop-limit handling

## Current limitations

- Layer-3 only: no ARP, switching, NAT, DHCP, or dynamic routing
- One link between a pair of devices; PCs have a single interface
- Save / Export in the toolbar are visual placeholders
- No persistence, no multi-user labs, and no packet animation beyond hop highlighting
- No WebMCP integration yet

WebMCP integration will allow compatible AI agents to inspect, simulate, and later interact with the same live network state used by the human interface.
