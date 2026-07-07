# popclass

> Pop-up Python classroom: teacher opens a notebook, students join by QR link, everyone runs Python in-browser, teacher sees every student's cells live. Zero installs, zero accounts, near-zero backend.

**Type**: A — Spec (agent implements from this README)
**Author**: Emmanuel Joliet (`ejoliet`)
**Date**: 2026-07-05
**Status**: Draft

## Purpose

- **Problem**: First session of any coding class is environment-setup hell. Existing fixes fail: Colab needs Google accounts; JupyterLab RTC (`jupyter-collaboration`) needs a running server, gives everyone edit rights on one shared doc, and has no teacher/student roles; JupyterLite runs serverless but real-time collaboration is still unshipped (listed as future work by the Jupyter Everywhere team, 2026).
- **Solution**: One static HTML page. Teacher hosts a class room. Students join via link/QR, each gets a private in-browser Python notebook (Pyodide). Student notebooks stream live to a teacher dashboard over P2P. Teacher pushes exercise cells to all students.
- **Who benefits**: Bootcamps, workshop hosts, high-school/university teachers. Buyer = teacher (host pays, students free).

## Architecture

**Topology: star, teacher = hub.** Each student holds one WebRTC DataChannel to the teacher only (PeerJS). Rejected full-mesh (`y-webrtc`): connections grow quadratically, every student would receive every other student's work (privacy leak), and mesh is unnecessary since all reads converge at the teacher.

Data flow:

1. Teacher page creates PeerJS peer with room ID → renders join QR (`?room=<id>&role=student`).
2. Student page connects to teacher peer, sends `hello {name}`.
3. Each student notebook = one Yjs `Y.Doc`. Student applies local edits; Yjs updates (binary diffs) sent over the DataChannel via a thin custom provider (`yjs-peerjs-provider`, ~100 lines).
4. Teacher holds a read-only replica `Y.Doc` per student → renders dashboard grid (name, last-run status, live cells).
5. Teacher's "class doc" (exercise template) is a separate `Y.Doc` broadcast teacher → all students; students can pull cells from it into their own notebook.
6. Execution is always local: one Pyodide Web Worker per browser. Outputs (stdout, errors, matplotlib PNG) written back into the student's `Y.Doc` so the teacher sees results, not just code.
7. Reconnect: reuse existing host/guest auto-reconnect pattern (exponential backoff, state resync via Yjs `encodeStateAsUpdate` on rejoin — CRDT makes rejoin trivially correct).

Components:

| Component | Runs where | Purpose |
|-----------|-----------|---------|
| `index.html` | Browser (single file) | Both roles; role switch via URL param |
| Pyodide worker | Student + teacher browser | Python execution, isolated per tab |
| yjs-peerjs-provider | Both | Y.Doc sync over PeerJS DataChannel |
| Signaling | PeerJS cloud (MVP) or self-hosted `peerjs-server` | Peer discovery only; no class data transits it |
| TURN (optional, paid tier) | Coturn on small EC2/Fly | Fallback for symmetric NAT |

## Recommended Stack

| Layer | Chosen | Signal | Why chosen | Rejected |
|-------|--------|--------|------------|----------|
| Python runtime | Pyodide (latest stable, CDN) | De-facto standard; powers JupyterLite and Jupyter Everywhere (Quansight, 2026) | Full scientific stack (numpy/pandas/matplotlib) via micropip; runs in a worker | JupyterLite (full Jupyter UI, heavy, hard to build a custom teacher dashboard on top); server kernels (violates zero-backend) |
| CRDT | Yjs | Dominant CRDT ecosystem; used by jupyter-collaboration itself | Binary diffs, awareness protocol, provider-agnostic, IndexedDB persistence available | Automerge (heavier docs, smaller ecosystem) |
| Transport | PeerJS 1.5.x + custom Yjs provider | Emmanuel's existing production pattern (host/guest, auto-reconnect, glare avoidance) | Max code reuse; star topology by construction | y-webrtc (mesh only: quadratic connections, exposes all peers' data to all peers per its own docs); y-websocket (needs stateful server) |
| Editor | CodeMirror 6 | Standard for in-browser code editors; first-class Yjs binding (`y-codemirror.next`) | Small, mobile-usable, collab cursors free | Monaco (heavy, weak mobile), plain textarea (no highlighting) |
| Signaling | PeerJS public cloud → self-host later | — | Zero backend for MVP | Custom Lambda/DynamoDB signaling (works — see NEXT AI's serverless Yjs writeup — but premature) |

> ✅ Override round done 2026-07-05: **star hub confirmed, no full mesh** (Emmanuel). Mesh permanently out of scope for v1.

## Repository Layout

```
popclass/
├── index.html            # Entire app: UI, roles, Pyodide boot, provider
├── src/                  # Pre-bundle sources (esbuild → inlined into index.html)
│   ├── provider.js       # yjs-peerjs-provider (star topology)
│   ├── notebook.js       # Cell model on Y.Doc: Y.Array<Y.Map{source, outputs, status}>
│   ├── runtime.js        # Pyodide worker wrapper: run(cell) → outputs
│   ├── teacher.js        # Dashboard grid, template push, export
│   └── student.js        # Notebook UI, join flow
├── server/               # OPTIONAL paid tier only
│   └── docker-compose.yml  # peerjs-server + coturn
├── test/
│   ├── provider.test.js  # Two Y.Docs over mocked DataChannel converge
│   └── notebook.test.js  # Cell CRUD, ipynb export round-trip
├── Makefile              # build, test, serve, lint
└── README.md
```

## Prerequisites

- Node 20+ (build only; artifact is static)
- Browsers: Chrome/Edge/Firefox/Safari current. Test iPad Safari — classrooms use them.
- No env vars for MVP. Paid tier: `TURN_URL`, `TURN_USER`, `TURN_CRED` (server-side only, never in committed code).

## Interface Contract

**URL scheme**

| URL | Role |
|-----|------|
| `/` | Teacher: creates room, shows QR |
| `/?room=<id>` | Student: name prompt → join |

**Notebook Y.Doc schema**

```
Y.Doc
└── cells: Y.Array<Y.Map>
    ├── id: string
    ├── source: Y.Text            # bound to CodeMirror
    ├── outputs: Y.Array<{type: 'stdout'|'error'|'image', data: string}>
    └── status: 'idle'|'running'|'ok'|'error'
meta: Y.Map { studentName, lastRunTs }
```

**Provider messages** (over DataChannel, alongside raw Yjs updates)

| Msg | Direction | Payload |
|-----|-----------|---------|
| `hello` | student → teacher | `{name, protocolVersion}` |
| `sync` | both | Yjs update (Uint8Array), tagged `docId` (`class` or `student:<peerId>`) |
| `push_cell` | teacher → students | cell JSON appended to class doc |
| `ping/pong` | both | liveness, 10 s interval |

**Export**: teacher exports any/all student notebooks as `.ipynb` (nbformat 4). Deterministic mapping from Y.Doc schema; must round-trip.

## Error Handling

| Failure | Behavior |
|---------|----------|
| Signaling unreachable | Banner + retry with backoff; teacher room ID persists in localStorage |
| Student DataChannel drops | Auto-reconnect; on rejoin send full `encodeStateAsUpdate` |
| Symmetric NAT (no TURN, free tier) | Detect ICE failure, show "network blocked — try hotspot" message; log rate (this number decides TURN economics) |
| Pyodide load failure (slow network) | Progress bar; editor usable before runtime ready; runs queue |
| Infinite loop in student code | `worker.terminate()` + respawn on Stop button; warm-reload interpreter state lost — acceptable v1 |

## Testing

- `make test`: vitest. Provider convergence (two docs, lossy/reordered channel), notebook model, ipynb export round-trip.
- Manual matrix before pilot: 1 teacher (laptop) + 25 students (mix phone/tablet/laptop) on school-grade Wi-Fi. Measure: join time, sync latency, teacher CPU/RAM with 25 live docs.

## Non-Goals (v1)

- No accounts, no persistence beyond teacher's browser + export
- No grading/autograding
- No student↔student collaboration
- No packages needing native wheels absent from Pyodide
- No R kernel
- Hard cap ~40 students/room (teacher upload + tab memory ceiling — verify in test matrix)

## Security Notes

- Room IDs: 128-bit random, unguessable; that is the v1 access control. Add room password (y-webrtc-style symmetric encryption over signaling) in v1.1.
- Teacher-side role enforcement: hub only accepts writes to `student:<peerId>` doc from that peerId. Client-side students are untrusted by design.
- Nothing sensitive in repo. TURN credentials via env only.

## Spike Results (2026-07-05, branch cursor/spike-yjs-peerjs-provider-f776)

Provider spike PASSED vs real PeerJS cloud (Playwright: 1 teacher + 2 students). Keystroke sync ~2 ms, star isolation confirmed, student rejoin restores from teacher replica, teacher refresh resyncs from students (students = source of truth). Pending: two-physical-machines manual run.

### Burned log
- TDZ crash: role dispatch called `docIdFor` before const init → use hoisted function declarations for module-top helpers.
- PeerJS `data` may deliver ArrayBuffer not Uint8Array → normalize in wrapper.
- Fast teacher refresh → `unavailable-id` while cloud holds old session → retry loop required.
- Signaling `disconnected` ≠ dead DataChannels → call `peer.reconnect()` to keep brokering new joins.
- Peer ids ephemeral → student identity = URL `sid` + hello control frame, app layer.
- Known leak: hello-before-STEP1 assumes ordered reliable channel → raw-WebRTC wrapper must set `ordered: true`.
- Premium hook in place: `window.POPCLASS_PEER_OPTIONS` injectable (self-host signaling/TURN = config, not code).

## Open Questions

- [x] Marimo check (2026-07-05): no live teacher-dashboard/classroom mode today. Sharing = molab URLs, downloads, Gradescope submission; autograding = pytest cells. BUT their April 2026 blog says they are "looking at building new notebook-native teaching tools" — funded team moving toward this space. Positioning: P2P privacy (student work never leaves the room, no cloud accounts) + live-during-class visibility. Ship fast.
- [ ] Teacher tab memory with 40 Y.Docs + rendered grids — need measurement, may force virtualized rendering.
- [ ] Pricing: $19/mo teacher vs $49 per-workshop one-off? Concierge-test both.
- [ ] iPad Safari WebRTC DataChannel background/tab-switch behavior during class.

## Agent Build Instructions

> Implement end-to-end from this README. Resolve Open Questions marked "before build" first.

### Build Order

| Phase | Deliverable | Done when |
|-------|-------------|-----------|
| 0 | Scaffold, Makefile, esbuild single-file output | `make build` emits one `index.html` |
| 1 | Notebook model + Pyodide worker (solo mode) | Run cells locally, outputs render |
| 2 | yjs-peerjs-provider | Provider tests pass over mock channel |
| 3 | Join flow + teacher dashboard | 2 real browsers: student edit visible to teacher < 1 s |
| 4 | Template push, ipynb export, reconnect | Export round-trips; kill/rejoin resyncs |
| 5 | Load test 25 clients (Playwright) | Metrics recorded, cap confirmed |

### Constraints

- Vanilla JS (ES2022), no framework — single-file discipline
- `// AIDEV-` annotations at protocol and topology decision points
- No secrets in code; TURN config env-only
- Provider must be transport-agnostic enough to swap PeerJS for raw WebRTC later

### Acceptance Criteria

- [ ] `make test` passes
- [ ] Cold student join → running code in < 15 s on mid-range phone, cable connection
- [ ] Teacher sees student keystrokes < 1 s, run results < 2 s
- [ ] Teacher refresh mid-class: all students auto-rejoin, no data loss
- [ ] `.ipynb` export opens clean in JupyterLab
- [ ] Works with signaling server as the only backend touched

## References

- Jupyter Everywhere / JupyterLite RTC status: https://labs.quansight.org/blog/jupyter-everywhere
- jupyter-collaboration role gap (teacher thread): https://discourse.jupyter.org/t/jupyter-collaboration-view-or-read-only-mode/31045
- y-webrtc limits and mesh caveats: https://github.com/yjs/y-webrtc
- Serverless Yjs signaling pattern: https://medium.com/collaborne-engineering/serverless-yjs-72d0a84326a2
- Pyodide: https://pyodide.org

## Next Steps

1. Answer the two "before build" Open Questions (Marimo check, topology override).
2. Phase 0–1: solo-mode notebook (already ~60% covered by existing Pyodide knowledge + single-file pattern).
3. Concierge test in parallel: landing page + 3 teachers/bootcamp instructors, offer a free live pilot.
