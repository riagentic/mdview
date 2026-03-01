# mdview

Desktop markdown viewer with syntax highlighting, search, and zoom.

Built with Deno + React + Electron on the [aio](https://github.com/riagentic/aio) framework.

## Usage

```sh
# open a file directly
mdview README.md

# or launch and use the native file picker
mdview
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+O | Open file (native dialog) |
| Ctrl+F | Search text |
| Enter / Shift+Enter | Next / previous match |
| Ctrl+P | Print |
| Ctrl+W | Close document |
| Ctrl++ / Ctrl+- | Zoom in / out |
| Ctrl+0 | Reset zoom |
| Ctrl+Scroll | Zoom in / out |
| Esc | Close search |

## Features

- GFM (GitHub Flavored Markdown) rendering
- Syntax highlighting with auto-detection
- In-document text search with match navigation
- Zoom (25% - 300%) via keyboard and mouse wheel
- Session persistence — reopens last document, scroll position, and zoom level
- Native OS file dialog via server-side zenity
- Window position and size persistence
- Print support

## Development

```sh
# run in dev mode (hot reload)
deno task dev

# app manager (status, state inspection, dispatch)
deno task am status

# compile to standalone binary
deno task compile

# compile as Electron app
deno task compile:electron
```

## Stack

- Deno 2.6+ / TypeScript / React 18 / Electron
- [aio](https://github.com/riagentic/aio) framework (state management + persistence)
- [marked](https://github.com/markedjs/marked) for markdown parsing
- [highlight.js](https://highlightjs.org/) for syntax highlighting
