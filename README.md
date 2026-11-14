# README

## About

This is the official Wails React-TS template.

You can configure the project by editing `wails.json`. More information about the project settings can be found
here: https://wails.io/docs/reference/project-config

## Plugins

Each utility is a plugin and appears as a non-closable tab in the sidebar.

To add one (say `foo`):

1. Backend: create `plugins/foo/` with a type implementing `plugins.Plugin` (`Startup`, `Shutdown`, `Bindings`), then add `foo.New()` in `plugins/registry.go`.
2. Frontend: create `frontend/src/plugins/foo/index.tsx` with a default export `PluginDef` (`id`, `title`, `icon`, `component`). It is auto-discovered.
3. Run `wails generate module` (or `wails dev`/`build`) to refresh the `wailsjs` bindings.

## Live Development

To run in live development mode, run `wails dev` in the project directory. This will run a Vite development
server that will provide very fast hot reload of your frontend changes. If you want to develop in a browser
and have access to your Go methods, there is also a dev server that runs on http://localhost:34115. Connect
to this in your browser, and you can call your Go code from devtools.

## VNC

Open the VNC module, enter the server's IP address or hostname and TCP port
(normally 5900), and optionally enter its VNC password. The remote desktop
supports mouse and keyboard control. No Guacamole server is needed.
Use the fullscreen icon in the viewer toolbar to expand or restore the desktop.
The Screenshot button captures the remote framebuffer at its original resolution.
Enable cropping to draw a box, drag its corners to resize, or focus the image and
use arrow keys to move the box and Ctrl+arrow keys to resize it. Before drawing,
arrow keys move the pointer and Enter selects each corner. Saving creates a new
named folder containing the full PNG, an optional cropped PNG, and coordinate
JSON; existing folders are never overwritten. Coordinates use an origin at the
top left, with right and bottom edges exclusive (so width = right - left).

Standard VNC password authentication does not encrypt the desktop traffic.
Use VNC only over a trusted network, VPN, or separately secured tunnel. Servers
requiring other authentication or encryption schemes may not be supported.
Passwords are not saved.

## Building

To build a redistributable, production mode package, use `wails build`.
