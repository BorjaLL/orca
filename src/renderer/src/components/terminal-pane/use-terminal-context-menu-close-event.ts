import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'

const CLOSE_ALL_CONTEXT_MENUS_EVENT = 'orca-close-all-context-menus'

export function closeAllTerminalContextMenus(): void {
  window.dispatchEvent(new Event(CLOSE_ALL_CONTEXT_MENUS_EVENT))
}

export function useTerminalContextMenuCloseEvent(
  menuOpenedAtRef: RefObject<number>,
  setOpen: Dispatch<SetStateAction<boolean>>
): void {
  useEffect(() => {
    const closeMenu = (): void => {
      if (Date.now() - menuOpenedAtRef.current < 100) {
        return
      }
      setOpen(false)
    }
    window.addEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
    return () => window.removeEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
  }, [menuOpenedAtRef, setOpen])
}
