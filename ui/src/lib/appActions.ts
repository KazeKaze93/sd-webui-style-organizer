import { createContext, useContext } from 'react'

/**
 * App-level dialogs that deep components (the grid's empty states) can open.
 * The open/closed state stays local to App; this only hands out the openers.
 */
export type AppActions = {
  openImportExport: () => void
  openNewStyle: () => void
  /** Same rule as the header's New style button. */
  canCreateStyle: boolean
}

export const AppActionsContext = createContext<AppActions | null>(null)

/** null outside App (e.g. a grid rendered alone): actions that need App are not offered. */
export function useAppActions(): AppActions | null {
  return useContext(AppActionsContext)
}
