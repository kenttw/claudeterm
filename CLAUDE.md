# ClaudeTerm

## Overview

A lightweight web terminal that lets you run Claude Code sessions from a mobile browser over WiFi — no app installation required.

```
Mac :7681  ←WebSocket→  Mobile Browser
```

## Start / Stop

```bash
# First run — interactive (prompts for base directory)
cd web-terminal && chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
SHELL=/bin/zsh node server.js

# Subsequent runs — background (base dir already saved in config.json)
SHELL=/bin/zsh nohup node server.js > /tmp/web-terminal.log 2>&1 &

# Stop
kill $(lsof -ti:7681)

# View logs
tail -f /tmp/web-terminal.log
```

### First-Run Setup

On first launch (no sessions exist and no `baseDir` in `config.json`), the server prompts in the CLI:

```
📂 Base directory for projects [/Users/<you>/git]:
```

Press Enter for default (`~/git`) or type a custom path. The choice is saved to `config.json` as `baseDir` and never asked again.

Connection URL: `http://<your-local-ip>:7681` (phone must be on the same WiFi as Mac)
Default credentials: `admin / admin`

---

## Architecture

| Layer | Technology |
|-------|------------|
| Shell bridge | `node-pty` — real pseudo-terminal |
| Transport | WebSocket (`ws`) — bidirectional input/output |
| Frontend | `xterm.js` v5.3 + `xterm-addon-fit` + `highlight.js` + `marked.js` |
| Server | `express` + Node.js |

### Known Issues & Fixes

**`posix_spawnp failed`**
- Cause: `node-pty`'s `spawn-helper` binary is missing execute permission
- Fix: `chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`
- May need to be re-run after each `npm install`

**WebSocket fails to establish terminal**
- Cause: Browsers do not send Basic Auth headers on WebSocket upgrade
- Fix: WS connections skip auth check; rely on HTTP-layer Basic Auth instead

**Terminal displays garbage chars `^[]11;rgb:...`**
- Cause: xterm.js responds to OSC color queries / CPR queries via `onData`, which gets forwarded back to the PTY causing an echo
- Fix: Client-side `isTerminalResponse()` filter intercepts these sequences and does not forward them to the server

**nohup environment missing `$SHELL`**
- Fix: Always start with `SHELL=/bin/zsh` prefix

---

## Session Management

### Persistence

Sessions are stored per subfolder:

```
sessions/
├── project-a/
│   └── sessions.json
├── project-b/
│   └── sessions.json
└── project-c/
    └── sessions.json
```

Each `sessions.json` format:

```json
{
  "sessions": [
    {
      "id": "1",
      "name": "myproject",
      "type": "claude",
      "cwd": "/home/user/git/myproject",
      "claudeSessionId": "6c2fdae6-2555-40ed-9eb1-bd495c1d99f7"
    }
  ]
}
```

- All sessions are automatically restored after server restart
- Shell sessions: respawned directly
- Claude sessions: pre-typed with `claude --resume <id>` for the user to press Enter

### Claude Session Resume Logic

1. `claudeSessionId` has a value → use it to resume
2. `claudeSessionId` is null → strip leading non-word prefix from session name (e.g. `✳ `, `⠐ `) and use the remainder as the resume ID
3. Manual override: edit `claudeSessionId` in `sessions.json` and restart

Auto-detection: if PTY output contains a UUID or `conv_`-prefixed ID, it is automatically saved to `claudeSessionId`.

### Session Type Detection

- Typing `claude` and pressing Enter → session is automatically tagged as `type: "claude"`

---

## URL Routing

Each subdirectory maps to a URL:

| URL | Behavior |
|-----|----------|
| `http://<IP>:7681/` | Shows dir picker modal; navigate to a subdir URL after selection |
| `http://<IP>:7681/project-a` | Auto-attaches to (or creates) a `project-a` session; only shows `project-a` tabs |
| `http://<IP>:7681/project-b` | Auto-attaches to `project-b` session; only shows `project-b` tabs |

- Navigating to root URL → dir picker opens automatically (lists all subdirs of `~/git`, sorted alphabetically)
- Selecting a directory → URL updates to `/<dirname>`, session is auto-attached or created
- Session tab bar only shows sessions belonging to the current URL's directory
- Switching session tabs → URL updates automatically
- Browser back/forward navigates between sessions
- Base directory: configurable via `config.json` `baseDir` (default: `~/git`)

---

## Desktop File Browser & Editor (>=900px only)

On desktop browsers, the layout becomes three resizable columns:

```
[ File Browser | File Preview/Editor | Terminal ]
```

### File Browser (left column)

- Auto-loads project directory from URL when session attaches
- Shows all files including hidden (`.git`, `.env`, etc.)
- Click folder → navigate into; `↑` button → go up
- Click file → opens in editor panel
- `⇄` button → open directory picker to switch root directory

### File Preview/Editor (middle column)

Three viewing modes toggled via buttons in the header:

| Mode | Behavior |
|------|----------|
| **Edit** | Editable textarea, Tab inserts 2 spaces, Cmd/Ctrl+S saves |
| **Code** | Read-only with syntax highlighting (highlight.js) |
| **Preview** | Rendered markdown (marked.js) — only for `.md` files |

Default mode by file type:
- `.md` → Preview (with Edit/Code/Preview toggles)
- `.py`, `.js`, `.json`, etc. → Code (with Edit/Code toggles)
- `.ipynb` → Notebook view (rendered cells with syntax highlighting + markdown)

### Drag-to-Resize

Green drag handles between panels. Drag to resize any column freely (min 120px each).

### Server APIs

| Endpoint | Description |
|----------|-------------|
| `GET /api/files?path=` | List directory contents (under `~/`) |
| `GET /api/file?path=` | Read file (max 2MB) |
| `POST /api/file` | Write file `{ path, content }` |

### Directory Picker

The session directory picker supports navigation:
- `↑` button to go up to parent directories
- Click a folder to select it for session creation
- When opened via `⇄` (file browser switch), click navigates into dirs and "✓ Use this directory" confirms

---

## Frontend Toolbar

| Button | Sends |
|--------|-------|
| Tab | `\t` |
| Enter | `\r` |
| ls | `ls\r` |
| cd | `cd ` (no Enter) |
| clear | `clear\r` |
| ⌫ | `\x7f` (backspace) |
| ^C | `\x03` (SIGINT) |
| 1 / 2 / 3 | digit characters |
| claude | `claude\r` + rename session to "Claude" |
| ▲▼◀▶ | ANSI arrow sequences |

The session `×` close button has a confirm modal (Cancel / Close).

Connection badges: when multiple clients are connected to the same session, a `●N` badge shows the count.

---

## Session Naming

- New sessions created via `+` are auto-named `session_1`, `session_2`, etc.
- Name changes to the Claude session name only after the user renames it (via the `claude` button or by typing the command).

---

## Directory Structure

```
claudeterm/
├── CLAUDE.md
├── sessions/               # Persisted session state (auto-managed)
│   ├── project-a/
│   │   └── sessions.json
│   └── <subfolder>/
│       └── sessions.json
└── web-terminal/
    ├── server.js           # Express + WebSocket + node-pty server
    ├── config.json          # User config (baseDir, claudeCommand, credentials)
    ├── package.json
    ├── package-lock.json
    └── public/
        └── index.html      # Frontend: xterm.js + file browser + editor + toolbar
```

---

## Configuration

### config.json

| Field | Default | Description |
|-------|---------|-------------|
| `baseDir` | `~/git` | Base directory for projects (set on first run) |
| `claudeCommand` | `claude` | Command to launch Claude Code |
| `user` | `admin` | Basic Auth username |
| `pass` | `admin` | Basic Auth password |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WEB_TERM_USER` | `admin` | Basic Auth username (overrides config.json) |
| `WEB_TERM_PASS` | `admin` | Basic Auth password (overrides config.json) |
| `PORT` | `7681` | Listening port |
