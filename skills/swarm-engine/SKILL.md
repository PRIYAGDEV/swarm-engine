---
name: swarm-engine
description: >-
  High-performance multi-agent coordination hub with interactive live board, dynamic communication DAG, execution timeline scrubber, and terminal TUI viewer.
license: MIT
metadata:
  version: 2.1.0
  author: PRIYAGDEV
---

# Swarm Engine: Multi-Agent Coordinator & Live Board

Interactive visual command center and operational board for multi-agent workflows (`https://antigravity.google/docs/swarm/` style).

---

## ⚡ MANDATORY PROTOCOL: When `/swarm-engine` Is Invoked

Whenever the user invokes `/swarm-engine [task]`, you MUST immediately execute this multi-agent workflow instead of running as a single agent:

1. **INITIALIZE THE SWARM**:
   - Deconstruct the user's task or existing project into clear, parallel sub-tasks.
   - Designate worker roles (e.g., `@architect`, `@engineer`, `@designer`, `@verifier`).
   - Assign non-overlapping files or responsibilities to each worker in the workspace.

2. **LAUNCH & PRESENT THE SWARM BOARD**:
   - Run `swarm-engine board --open` (or `swarm-engine board --serve` on `http://localhost:3456`) to open the live visual dashboard for the user.
   - Or generate the standalone board via `swarm-engine board --html`.
   - Provide the user with the direct link to the board and the terminal command: `swarm-engine board`.

3. **COORDINATE ON THE BOARD**:
   - Post worker assignments and sequence checkpoints to `.swarm/board.jsonl`.
   - Use direct doorbells (`@worker`) so each agent knows what it owns and what "done" looks like.
   - Run verification checks (tests, audits, diff reviews) before declaring milestones complete.

---

## 📊 The Swarm Board Features

- **Split-View Web Dashboard (`--serve` / `--open`)**:
  - **Board Tab**: Monotonic sequence of posts, colored agent avatars, `@sender → @targets`, expandable diff disclosures, and facet filters (`All`, `@coordinator`, `@worker`, `Files`, `Verifications`).
  - **Members Tab**: Live team roster with status indicators (🟢 Working, 🟡 Standby, ⚪ Done) and assigned files.
  - **Graph & Timeline Scrubber**: Dynamic SVG communication DAG with interactive step-by-step playback slider (`⏮`, `◀`, `▶ Play / ⏸ Pause`, `▶`, `⏭`).
  - **Usability**: Interactive cross-reference links (`(ref #1)`), one-click copy chips for paths/commands, and one-click GitHub PR export.

- **Terminal TUI Viewer (`swarm-engine board`)**:
  - Keyboard shortcuts: `tab` switch pane · `enter` view post · `space` expand · `p` filter · `f` follow · `q` exit.

---

## 🛠️ CLI Quick Reference

```bash
swarm-engine board --open   # Open live board in default browser
swarm-engine board --serve  # Start background web server (http://localhost:3456)
swarm-engine board          # Launch interactive terminal TUI
swarm-engine board --html   # Export self-contained HTML (.swarm/board.html)
swarm-engine status         # Print formatted swarm roster table
```
