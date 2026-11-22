/** Name shown on selection tray chips (and in the conflicts popover): the style name without its category prefix. */
export const trayDisplayName = (name: string) =>
  name.includes('_') ? name.split('_').slice(1).join(' ') : name
