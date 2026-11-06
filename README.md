# Logtail for VSCode

A dual-engine, lightweight VSCode extension that allows you to stream and monitor real-time logs directly inside your IDE. Stop switching contexts between your terminal window and your code editor.

## Features

- **Dual-Engine Display:** Choose where you want to view your logs:
  - **Terminal (PTY):** Extremely fast, native ANSI color support, optimized memory management.
  - **Editor Tab:** Read-only virtual document view, duplicated to the Output Channel.
- **Dynamic Buffer Limit:** Prevent Out-of-Memory (OOM) UI freezes in Editor mode by setting custom character limits, or unleash it completely with an unlimited buffer.
- **Live Streaming:** Stream logs using `tail -f`, `journalctl`, `docker logs -f`, or `kubectl logs -f`.
- **Graceful Shutdown:** Safely cleans up zombie processes when you stop a stream or close VSCode.

## Usage

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac).
2. Type and run: **`Logtail.start`**
3. **Select View Target:**
   - `Editor Sekmesi`: Opens the logs in a read-only text file format.
   - `Terminal (PTY)`: Opens the logs in the integrated terminal with full color support.
4. **Enter Log Command:**
   - Example (Linux/Mac): `tail -f /var/log/syslog`
   - Example (Docker): `docker logs -f my-container`
   - Example (Kubernetes): `kubectl logs -f pod-name`
5. **Set Buffer Limit (Only for Editor Mode):**
   - By default, it is set to `2000000` characters to keep your IDE responsive.
   - Enter `0` for **Unlimited** buffer. *(Warning: Continuous high-volume logs with unlimited buffer may freeze the VSCode UI).*

## Extension Settings & Requirements

This extension relies on your local shell environment. Ensure the executables you are trying to run (`tail`, `docker`, `kubectl`) are in your system's `PATH`.

## Known Issues

- **Shell Operators:** Complex shell operations like piping (`|`) or redirects (`>`) are not directly supported inside the input box because the command is spawned directly (`shell: false`) for process stability.

## Release Notes

### 1.1.0
- Added Dual-Engine architecture (Editor vs Terminal).
- Added dynamic buffer management for Editor mode (0 for unlimited).
- Implemented graceful shutdown for orphaned spawned processes.
### 1.0.0
- Initial release with pseudo-terminal architecture.
