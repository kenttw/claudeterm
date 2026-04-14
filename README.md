# ClaudeTerm

A lightweight web terminal that lets you run [Claude Code](https://claude.ai/code) sessions from a mobile browser over WiFi — no app installation required.

```
Mac :7681  ←WebSocket→  Mobile Browser
```

## Features

- Run Claude Code from your phone while your Mac does the work
- Multiple named sessions with persistent state (survives server restarts)
- Per-project URL routing (`/project-a`, `/project-b`, ...)
- Mobile-friendly toolbar with common keys (Tab, Ctrl+C, arrows, etc.)
- Basic Auth protection
- **Desktop 3-column layout**: file browser + editor/preview + terminal
- **File tabs** with per-tab content cache (VS Code-style)
- **File preview**: syntax highlighting, markdown, ipynb notebook, CSV, HTML (sandboxed), images
- **Line numbers** in code view with scroll sync
- **Git status color hints** in file browser (modified / staged / untracked)
- **Ask Claude** button on files — sends `Read <path>` directly to terminal
- Per-directory open files persisted to `sessions.json`

## Requirements

- macOS (uses `node-pty` with darwin prebuilds)
- Node.js
- [Claude Code](https://claude.ai/code) installed (`npm install -g @anthropic-ai/claude-code`)

## Install

```bash
cd web-terminal
npm install
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
```

## Start / Stop

```bash
# Start (from the web-terminal directory)
SHELL=/bin/zsh nohup node server.js > /tmp/web-terminal.log 2>&1 &

# Stop
kill $(lsof -ti:7681)

# View logs
tail -f /tmp/web-terminal.log
```

Open `http://<your-local-ip>:7681` on your phone (same WiFi).  
Default credentials: `admin / admin`

Change via environment variables:

```bash
WEB_TERM_USER=myuser WEB_TERM_PASS=mypass SHELL=/bin/zsh nohup node server.js ...
```

## URL Routing

Each project maps to a URL path based on subdirectory name under `~/git`:

| URL | Behavior |
|-----|----------|
| `http://<IP>:7681/` | Directory picker — select a project to open |
| `http://<IP>:7681/my-project` | Opens (or resumes) sessions for `my-project` |

Sessions are stored in `sessions/<project>/sessions.json` and auto-restored on restart.

## Desktop Layout (≥900px)

On desktop browsers the UI splits into three resizable columns:

```
[ File Browser | File Preview/Editor | Terminal ]
```

Drag the green handles between columns to resize.

### File Browser

- Shows all files including hidden (`.git`, `.env`, etc.)
- **Git status colors**: modified = orange, staged/untracked = green
- Click file → open in editor; click folder → navigate
- Hover a file → **Ask** button appears; click to send `Read <path>` to the terminal
- `↑` to go up, `⇄` to switch root directory

### File Editor / Preview

| Mode | Behavior |
|------|----------|
| Edit | Editable textarea, Tab = 2 spaces, Cmd/Ctrl+S saves |
| Code | Read-only with syntax highlighting + line numbers |
| Preview | Rendered markdown (`.md`) or sandboxed HTML (`.html`) |
| Notebook | Rendered `.ipynb` cells with syntax highlighting + markdown |
| CSV | Scrollable table (up to 1000 rows) |
| Image | Inline image display |

Open files are shown as tabs. State (scroll position, mode, unsaved edits) is preserved per tab and persisted across server restarts.

## Frontend Toolbar

| Button | Sends |
|--------|-------|
| Tab | `\t` |
| Enter | `\r` |
| ls | `ls\r` |
| cd | `cd ` |
| clear | `clear\r` |
| ⌫ | Backspace |
| ^C | SIGINT |
| 1 / 2 / 3 | digit |
| claude | `claude\r` |
| ▲▼◀▶ | Arrow keys |

## Architecture

| Layer | Technology |
|-------|------------|
| Shell bridge | `node-pty` — real pseudo-terminal |
| Transport | WebSocket (`ws`) |
| Frontend | `xterm.js` v5.3 + `xterm-addon-fit` + `highlight.js` + `marked.js` |
| Server | `express` + Node.js |

## Configuration

### config.json

| Field | Default | Description |
|-------|---------|-------------|
| `baseDir` | `~/git` | Root directory for project listing |
| `claudeCommand` | `claude` | Command to launch Claude Code |
| `user` | `admin` | Basic Auth username |
| `pass` | `admin` | Basic Auth password |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WEB_TERM_USER` | `admin` | Basic Auth username (overrides config.json) |
| `WEB_TERM_PASS` | `admin` | Basic Auth password (overrides config.json) |
| `PORT` | `7681` | Listening port |

## Server API

| Endpoint | Description |
|----------|-------------|
| `GET /api/files?path=` | List directory contents |
| `GET /api/file?path=` | Read file (max 2MB) |
| `POST /api/file` | Write file `{ path, content }` |
| `GET /api/git-status?path=` | Git status for directory (porcelain) |
| `GET /api/dirs` | List project subdirectories |
| `GET /api/token` | Issue single-use WebSocket auth token |

## Known Issues

**`posix_spawnp failed`** — `spawn-helper` missing execute bit  
Fix: `chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`

**Terminal shows garbage `^[]11;rgb:...`** — OSC/CPR echo loop  
Fixed client-side: `isTerminalResponse()` filter blocks these from reaching the PTY.

**WebSocket auth fails** — browsers don't send Basic Auth on WS upgrade  
Fixed: WS connections use a short-lived token issued via `/api/token`.

## License

MIT
