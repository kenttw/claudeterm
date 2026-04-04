# mytt — Web Terminal Design Document

> **One-liner**: Access and control your Mac shell from a mobile browser over WiFi — no app installation required.

---

## 1. Project Goals

| Requirement | Description |
|-------------|-------------|
| Mobile access | Phone connects to Mac over local WiFi |
| No app install | Pure browser experience; xterm.js renders the terminal |
| Multiple sessions | Open multiple shell sessions simultaneously, like tmux tabs |
| Mobile-friendly controls | Bottom toolbar with touch buttons to replace keyboard |

---

## 2. Overall Architecture

```
Mobile Browser (xterm.js)
    │
    ├── HTTP GET /        → Static index.html (loaded once)
    │
    └── WebSocket ws://   → Bidirectional real-time communication
                │
         server.js        (Node.js + Express + ws)
                │
         node-pty         (Pseudo-terminal layer)
                │
         /bin/zsh         (CWD: ~/git)
```

---

## 3. Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Backend runtime | Node.js | - |
| HTTP server | Express | ^4.18.2 |
| WebSocket server | ws | ^8.14.2 |
| Pseudo-terminal | node-pty | ^1.0.0 |
| Frontend terminal renderer | xterm.js (CDN) | 5.3.0 |
| Auto-resize addon | xterm-addon-fit (CDN) | 0.8.0 |
| Shell | /bin/zsh | - |

---

## 4. Core Concepts

### 4.1 Pseudo-terminal (PTY)

`node-pty` creates a pseudo-terminal device, making zsh believe it is talking to a real TTY. This enables:
- ANSI escape codes (colors, cursor movement) to work correctly
- Tab completion, command history, and arrow keys to work correctly
- Programs like `vim` and `htop` to use full-screen mode

Each session has its own independent PTY process, completely isolated from others.

### 4.2 Session Object

```js
// sessions: Map<id, Session>
{
  id: "1",                    // Auto-incrementing string ID
  name: "session_1",          // Display name (can be renamed)
  shell: ptyProcess,          // node-pty instance
  clients: Set<WebSocket>,    // All browser clients currently attached
  buffer: string              // Last 50,000 chars of output (for replay on attach)
}
```

**Buffer Replay**: When a new client attaches to an existing session, the server immediately sends the full `buffer` so the screen catches up to the current state.

### 4.3 WebSocket Message Protocol

All messages are JSON, distinguished by the `type` field:

**Client → Server**

| type | Description | Fields |
|------|-------------|--------|
| `session.create` | Create a new session | `name`, `cwd` |
| `session.attach` | Switch to a session | `id` |
| `session.rename` | Rename a session | `id`, `name` |
| `session.kill` | Close a session | `id` |
| `input` | Keyboard input to shell | `data` |
| `resize` | Terminal size change | `cols`, `rows` |

**Server → Client**

| type | Description | Fields |
|------|-------------|--------|
| `session.list` | All current sessions | `sessions: [{id, name, type, dir, ...}]` |
| `session.attached` | Successfully attached | `id`, `name`, `sessionType`, `dir` |
| `output` | Shell output data | `data` |

### 4.4 Authentication

HTTP Basic Auth protects all routes (including the HTTP handshake before WebSocket upgrade).

- Credentials set via environment variables: `WEB_TERM_USER` / `WEB_TERM_PASS`
- Defaults: `admin` / `admin`
- WebSocket connections do NOT re-check auth (browsers don't send Basic Auth on WS upgrade)

### 4.5 Frontend UI Structure

```
┌──────────────────────────────────────────┐
│  [session_1 ×] [session_2 ×]  [＋]       │  ← Session bar (horizontally scrollable)
├──────────────────────────────────────────┤
│                                          │
│           xterm.js terminal area         │  ← flex: 1, fills remaining space
│                                          │
├──────────────────────────────────────────┤
│  Tab  Enter  ls  cd  clear  ⌫  ^C  1 2 3 │  ← Toolbar
│  [codemax claude]  [▲][◀][▼][▶]          │
└──────────────────────────────────────────┘
```

Toolbar button inputs:

| Button | Data sent | Description |
|--------|-----------|-------------|
| Tab | `\t` | Tab completion |
| Enter | `\r` | Submit command |
| ⌫ | `\x7f` | Backspace |
| ^C | `\x03` | Interrupt process |
| ▲ / ▼ | `\x1b[A` / `\x1b[B` | ANSI arrow keys |
| ◀ / ▶ | `\x1b[D` / `\x1b[C` | ANSI arrow keys |
| codemax claude | `codemax claude\r` | Quick-launch Claude Code |

---

## 5. Data Flow

### 5.1 Input Flow (finger → shell)

```
User taps button / physical keyboard input
    → term.onData(data)
    → ws.send({ type: 'input', data })
    → server.js receives
    → session.shell.write(data)
    → zsh processes input
```

### 5.2 Output Flow (shell → screen)

```
zsh generates output
    → shell.onData(data)
    → session.buffer += data (truncated to 50,000 chars)
    → broadcast { type: 'output', data } to all session.clients
    → browser ws.onmessage
    → term.write(data)
    → xterm.js renders ANSI escape codes
```

### 5.3 Resize Flow

```
Window resize / visualViewport resize event
    → fitAddon.fit()       (recalculate cols/rows)
    → term.onResize({ cols, rows })
    → ws.send({ type: 'resize', cols, rows })
    → shell.resize(cols, rows)  (sync PTY dimensions)
```

---

## 6. Starting the Server

```bash
cd web-terminal
npm install
node server.js
# Or with environment variables
PORT=7681 WEB_TERM_USER=myuser WEB_TERM_PASS=mypass node server.js
```

Default connection URL: `http://<Mac-IP>:7681`

---

## 7. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Terminal renderer | xterm.js (CDN) | No bundling needed; full-featured; complete VT100 support |
| Transport protocol | WebSocket | Bidirectional real-time; low latency |
| Session isolation | Separate PTY process per session | No interference; parallel work possible |
| Buffer size limit | 50,000 chars | Balance between memory usage and replay completeness |
| Base CWD | `~/git` | Sensible default for a development workflow |
| No database | in-memory Map + JSON files | Lightweight personal tool; JSON files provide persistence without a DB |
| URL routing | `/<subdir>` per project | Bookmarkable URLs; tab bar filtered by project |
| Session naming | `session_1`, `session_2`, ... | Neutral names until user renames; Claude sessions renamed explicitly |
