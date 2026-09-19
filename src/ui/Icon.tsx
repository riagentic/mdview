// One icon set for the whole app: 24×24 line glyphs, stroke-only, drawn in
// `currentColor`, so every icon picks up the theme and button state from CSS
// (`.icon` sets stroke width/caps). Each glyph is a list of path `d` strings —
// pure data, rendered by <Icon> for JSX and by iconSvg() for imperative DOM.

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`

const FILE = 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'
const FILE_FOLD = 'M14 3v5h5'
const FOLDER = 'M3 7.5A2.5 2.5 0 0 1 5.5 5h3.3a2 2 0 0 1 1.4.6L11.6 7h6.9A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z'

const GLYPHS = {
  sidebar: ['M5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4z', 'M9.5 4v16', 'M5.5 8h1.5', 'M5.5 11h1.5'],
  back: ['M15 18l-6-6 6-6'],
  forward: ['M9 18l6-6-6-6'],
  chevronRight: ['M10 7l5 5-5 5'],
  chevronDown: ['M7 10l5 5 5-5'],
  chevronUp: ['M18 15l-6-6-6 6'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', circle(12, 12, 3)],
  pencil: ['M16.5 3.8a2.3 2.3 0 0 1 3.2 3.2L7.5 19.2 3.5 20.5l1.3-4z', 'M14.5 5.8l3.2 3.2'],
  outline: ['M4 6h16', 'M8 12h12', 'M12 18h8', 'M4 12h.01', 'M8 18h.01'],
  file: [FILE, FILE_FOLD],
  fileText: [FILE, FILE_FOLD, 'M9 13h6', 'M9 17h4'],
  filePlus: [FILE, FILE_FOLD, 'M12 11.5v6', 'M9 14.5h6'],
  folder: [FOLDER],
  folderOpen: ['M3 16.5V7.5A2.5 2.5 0 0 1 5.5 5h3.3a2 2 0 0 1 1.4.6L11.6 7h5.9A2.5 2.5 0 0 1 20 9.5V10', 'M3 16.5l2.2-5A2.5 2.5 0 0 1 7.5 10h13.2a1 1 0 0 1 .9 1.4l-2.5 5.6a3 3 0 0 1-2.7 2H5.5A2.5 2.5 0 0 1 3 16.5z'],
  folderPlus: [FOLDER, 'M12 9.5v6', 'M9 12.5h6'],
  sun: [circle(12, 12, 4), 'M12 2.5v2', 'M12 19.5v2', 'M5.3 5.3l1.4 1.4', 'M17.3 17.3l1.4 1.4', 'M2.5 12h2', 'M19.5 12h2', 'M5.3 18.7l1.4-1.4', 'M17.3 6.7l1.4-1.4'],
  moon: ['M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.5 6.5 0 0 0 10 10z'],
  printer: ['M7 8V3.5h10V8', 'M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M7 13.5h10v7H7z'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  trash: ['M4 7h16', 'M9.5 7V4.5h5V7', 'M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7', 'M10 11v6', 'M14 11v6'],
  rename: ['M13 20h8', 'M15.5 4.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z'],
  search: [circle(11, 11, 6.5), 'M20.5 20.5l-4.9-4.9'],
  globe: [circle(12, 12, 9), 'M3 12h18', 'M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z'],
  alert: [circle(12, 12, 9), 'M12 7.5v5.5', 'M12 16.5h.01'],
  refresh: ['M20 11.5A8 8 0 1 0 17.7 17.3', 'M20 4.5v7h-7'],
  copy: ['M10 8.5h8.5A1.5 1.5 0 0 1 20 10v9.5a1.5 1.5 0 0 1-1.5 1.5H10A1.5 1.5 0 0 1 8.5 19.5V10A1.5 1.5 0 0 1 10 8.5z', 'M15.5 8.5V5A1.5 1.5 0 0 0 14 3.5H5.5A1.5 1.5 0 0 0 4 5v9a1.5 1.5 0 0 0 1.5 1.5h3'],
  markdown: ['M5 5h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z', 'M6 15V9l2.5 3L11 9v6', 'M16.5 9v6', 'M14 12.5l2.5 2.5 2.5-2.5'],
} as const satisfies Record<string, readonly string[]>

export type IconName = keyof typeof GLYPHS

/** JSX icon. Decorative by default — the owning button carries the label. */
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {GLYPHS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}

/** Same glyph as an HTML string, for DOM built outside the renderer. */
export const iconSvg = (name: IconName, size = 14): string =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${
    GLYPHS[name].map((d) => `<path d="${d}"/>`).join('')
  }</svg>`
