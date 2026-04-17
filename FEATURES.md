# ClaudeTerm Feature Guide

## Core Features

### 1. File Tabs
- The editor panel supports multiple open files, each displayed as a tab
- Tab content is cached — no reload needed when switching
- Tab header shows filename, dirty state (Saved/Save), and close button
- **Shortcut**: Cmd/Ctrl+S to save the current file

### 2. File Preview & Edit Modes

| File Type | Default Mode | Available Modes |
|-----------|-------------|-----------------|
| `.md` | Preview | Edit / Code / Preview |
| `.html` / `.htm` | Preview | Edit / Code / Preview |
| `.py` / `.js` / `.json` etc. | Code | Edit / Code |
| `.ipynb` | Notebook | (read-only) |
| `.csv` / `.tsv` | Table | (read-only) |
| Images (`.png` / `.jpg` etc.) | Image | (read-only) |

### 3. Code View
- Syntax highlighting via highlight.js (vs2015 theme)
- **Line numbers**: shown on the left, scroll-synced with content
- Supports Python, JavaScript, JSON, Bash, YAML, Go, Rust, Java, Ruby, and more

### 4. Markdown Preview
- Rendered using marked.js
- Code blocks automatically syntax-highlighted
- **HTML support**: `.html` files previewed via sandboxed iframe (supports inline scripts and styles)

### 5. Jupyter Notebook View
- Renders `.ipynb` files with Code cells (including outputs) and Markdown cells
- **Language detection**: auto-detects kernel language; falls back to Python for unregistered languages
- Render errors display a friendly message instead of crashing

### 6. CSV/TSV Table View
- Auto-detects delimiter (`,` or `\t`)
- Displays up to 1,000 rows (shows notice if truncated)
- Handles quoted fields

### 7. File Auto-Reload
- **Background polling**: checks mtime of all open files every 3 seconds
- If a file changes on disk, it is automatically reloaded — only for non-dirty tabs
- Tabs with unsaved edits (dirty) are never overwritten

### 8. Open Files Persistence
- Each project directory saves its open file list to `sessions/$dir/sessions.json`
- Format:
  ```json
  {
    "openFilesList": ["/path/to/file1.md", "/path/to/file2.py"],
    "openFilesActive": 0
  }
  ```
- Automatically restored on server restart or session switch

---

## Session Features

### 9. Session Notes (📝)
- Each session tab has a **📝** button — click to open or create the session's notes file
- Notes path: `$project_root/sessions/$session_name.md`
- **Auto-create**: first click creates the file with a template:
  ```markdown
  # $session_name

  ## Key Points
  -

  ## Related Files
  -

  ## Tickets / Confluence
  -
  ```
- **Claude integration**: for Claude sessions, clicking 📝 automatically sends a prompt asking Claude to update the notes file

### 10. Auto-Load Session Notes
- When attaching to any session, if `sessions/$name.md` exists it opens automatically in the editor panel
- No need to manually click 📝

### 11. Quick Session Switch (Keyboard Shortcut)
- **Option (Alt) + ← / →**: cycle through sessions in the current project directory
- Works in both the Terminal and Editor panels
- **Note**: iOS Safari does not support the Option key

---

## File Browser

### 12. Git Status Colors
- **Orange (#e2c08d)**: Modified — changed but not yet staged
- **Green (#73c991)**: Staged / Untracked — staged or newly added files
- **White**: committed, no changes
- Updated in real time via `git status --porcelain`

### 13. Current Git Branch Display
- **Desktop (≥900px)**: shown on the right side of the toolbar as `⎇ main` (green badge)
- **Mobile (<900px)**: hidden to preserve toolbar space
- Updates automatically when navigating to a different directory

---

## Toolbar Buttons

| Button | Action | Notes |
|--------|--------|-------|
| Tab | Send `\t` | Inserts 2 spaces in the editor |
| Enter | Send `\r` | Execute command or newline |
| ⌫ | Send `\x7f` (backspace) | |
| ^C | Send `\x03` (SIGINT) | Interrupt running process |
| 1 | Send `1` | Quick number input |
| codemax claude | Send `codemax claude\r` + rename session | Launch Claude Code |
| cont inue | Send `codemax claude --continue\r` | Continue last conversation |
| do next item | Send `codemax claude --next\r` | Execute next todo item |
| 📂 folder | Open directory picker | Switch project |
| ▲ | Send `\x1b[A` | Previous history entry |
| ▼ | Send `\x1b[B` | Next history entry |

**Removed buttons**: `ls` / `cd` / `clear` / arrow left / arrow right / button 2 / button 3

---

## Layout & Responsive Design

### Desktop (≥900px)
```
┌─────────────────────────────────────────┐
│ Session Tabs                    ⎇ main  │
├─────────────┬──────────────┬────────────┤
│   File      │   Editor     │  Terminal  │
│  Browser    │   Panel      │   Column   │
│             │              │            │
│ (draggable) │  (draggable) │            │
├─────────────┴──────────────┴────────────┤
│              Toolbar Buttons            │
└─────────────────────────────────────────┘
```

### Mobile (<900px)
```
┌─────────────────────────┐
│  Session Tabs (scroll)  │
├─────────────────────────┤
│  Terminal (fullscreen)  │
├─────────────────────────┤
│    Toolbar Buttons      │
└─────────────────────────┘
```

- 3-column layout with draggable dividers (min 120px per column)
- Session tabs scaled 1.2× (padding: 7px 14px, font-size: 14px)
- Toolbar buttons auto-expand to fill full width (`flex: 1`)

---

## Server API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/files?path=` | GET | List directory contents |
| `/api/file?path=` | GET | Read file content (includes mtime) |
| `/api/file-stat?path=` | GET | Get file mtime only (lightweight) |
| `/api/file` | POST | Write file (auto-creates parent dirs) |
| `/api/git-status?path=` | GET | Query git status (parsed map) |
| `/api/git-branch?path=` | GET | Get current git branch name |
| `/api/dirs` | GET | List all projects under base dir |
| `/api/token` | GET | Get WebSocket auth token |
| `/api/config` | GET | Get server configuration |

---

## Persistence & Restore

### Session Restore
- On startup, server scans `sessions/$dir/sessions.json` and restores all sessions
- Claude sessions: pre-types `codemax claude --resume $id` (user presses Enter to resume)
- Shell sessions: PTY respawned directly in the original `cwd`
- Supports auto-detected UUID and manual `claudeSessionId` override

### Open Files Restore
- On session attach, if `openFilesList` exists all tabs are restored with content
- Missing files are skipped silently

### Session Notes Restore
- On session attach, if `sessions/$name.md` exists it is opened automatically

---

## Known Limitations

- ⚠️ File size limit: 2MB for `/api/file`, 10MB for `/api/file/raw`
- ⚠️ CSV preview capped at 1,000 rows
- ⚠️ Git query timeout: 3 seconds
- ⚠️ `git-status` and `git-branch` run in parallel per directory load — may add latency on slow repos

---

## Quick Start

### Start the server
```bash
cd /Users/kent/git/claudeterm/web-terminal
SHELL=/bin/zsh node server.js
```

### Connect
- **Desktop**: `http://localhost:7681`
- **Mobile**: `http://<your-ip>:7681` (must be on the same WiFi)
- **Auth**: Basic Auth (default `admin` / `admin`, override via `WEB_TERM_USER` / `WEB_TERM_PASS`)

### First Run
The server prompts for a base directory (default `~/git`). The choice is saved to `config.json` and never asked again.

---

*Last updated: 2026-04-18*
