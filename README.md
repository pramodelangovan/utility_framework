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

## Remote Files

The Remote Files utility browses an SSH server using SFTP, with password or
private-key authentication. It shares saved logins and host-key checks with
the SSH terminal; startup commands are not run in file sessions. Select a
folder to navigate, or enter a remote path. Upload and download use native
file dialogs and transfer one regular file at a time. Existing files are not
overwritten; choose a different name or destination if one already exists.
Switch between list and grid views. Names starting with a dot are hidden by
default; select "Show hidden files" to include them. Sort either view by name,
size, modification time, or owner in ascending or descending order; folders
remain first. Both views show folder and file icons; known code, log,
text, and configuration files have type labels. Click a name or icon to open
the folder or file, or select `..` to go to the parent folder. In list view,
use the download button to download a file.
Alternatively, right-click an entry in either view and select Open or, for a
file, Download. The context menu also opens with the context-menu key or
Shift+F10. The default context menu is disabled elsewhere in the app.
These view options apply to the current file session.
In narrow list views only names are shown; use the context menu to download.
Use Find files or Ctrl+F to highlight matching names in the current directory;
Previous and Next move between visible matches. Search is case-insensitive and
respects the hidden-files setting.
List view shows human-readable sizes, permissions, and owner names resolved from
the remote `/etc/passwd` over SFTP. Accounts supplied only by directory services
or inaccessible passwd files are shown as UIDs when names cannot be resolved.
Some SFTP servers omit owner attributes; UID 0 is marked as potentially
unavailable because the SFTP library cannot distinguish a missing UID from UID 0.
The server must support the SFTP subsystem.

Open a video (including MPG/MPEG, MP4, MKV, AVI and WebM) to stream it to a
locally installed VLC player. Keep the file session and app open during playback;
closing either stops the token-protected localhost HTTP stream. If VLC cannot be
found, choose to open its official download page or download the video instead.
VLC must be on the system PATH or installed in its standard Windows or macOS
location.

HTML and HTM files open as interactive webpages inside the app, with a View
source option. The isolated preview runs scripts and can access the network and
files within the HTML file's directory and its subdirectories; open only trusted
HTML. Relative resources in that directory are served over a temporary
token-protected localhost connection, which closes with the preview. Absolute
server paths, symbolic-link resources, and resources outside that directory are
not mapped. Server-side code is not executed.

Open a text file to launch a full-window, read-only UTF-8 text viewer. Use the
back arrow, close button or Escape to return to the file list. Find and
Highlights are separate toolbar controls; Ctrl+F opens Find. Known code and
configuration formats receive syntax highlighting; logs also highlight common
severity keywords. Add and remove custom highlighted words or phrases in the
viewer. Search highlights matches and supports previous/next, optional wrapping,
case sensitivity and whole-word matching; word wrap can be toggled separately.
Files are loaded in 64 KiB chunks. Previous and Next search the loaded text;
Search whole file scans every chunk and toggles the results pane. Select
a result to load its surrounding text. Search terms are literal, not regular
expressions. Results are paged in batches of 200;
changing pages scans the file again. Searches can be cancelled, and use the
same case and whole-word options. Load more or Load remaining extends the
current view; loading the remainder of a very large file may consume significant
memory. Other binary or non-UTF-8 files cannot be viewed.

PNG, JPEG, GIF, WebP, BMP, ICO, AVIF and SVG files open in an image viewer
(subject to the platform's image support). Use Ctrl+scroll or the zoom buttons
to zoom, and the arrow keys or toolbar buttons to move between visible images
in the current directory. Copy image places the displayed image on the system
clipboard as a PNG (the current frame for animated images); Download saves the
original file. Clipboard access depends on platform support and permissions.
Escape closes the viewer. Images larger than 64 MiB cannot be opened in the
viewer; use Download instead.

## VNC

Open the VNC module, enter the server's IP address or hostname and TCP port
(normally 5900), and optionally enter its VNC password. The remote desktop
supports mouse and keyboard control. No Guacamole server is needed.
VNC logins can be saved, edited, and deleted; optionally remember their passwords
in the OS credential store. Failed connections can be retried in the session.
When a server requests a password, enter it in the prompt; a session closes
after three rejected password attempts, including an initially supplied password.
Use the fullscreen icon in the viewer toolbar to expand or restore the desktop.
The Screenshot button captures the remote framebuffer at its original resolution.
Enable cropping to draw a box, drag its corners to resize, or focus the image and
use arrow keys to move the box and Ctrl+arrow keys to resize it. Before drawing,
arrow keys move the pointer and Enter selects each corner. Hold Shift with arrow
keys to move or resize by 10 pixels instead of one. Use Ctrl+scroll over the
preview to zoom, and hold Space while dragging to pan the zoomed image.
Saving creates a new
named folder containing the full PNG, an optional cropped PNG, and coordinate
JSON; existing folders are never overwritten. Coordinates use an origin at the
top left, with right and bottom edges exclusive (so width = right - left).

Standard VNC password authentication does not encrypt the desktop traffic.
Use VNC only over a trusted network, VPN, or separately secured tunnel. Servers
requiring other authentication or encryption schemes may not be supported.
Passwords are saved only when explicitly requested.

## Building

To build a redistributable, production mode package, use `wails build`.
