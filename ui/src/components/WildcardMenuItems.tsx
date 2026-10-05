import { sendToHost, WILDCARD_KIND_DECK } from '../bridge'
import { useStylesStore } from '../store/stylesStore'

const MENU_BTN =
  'w-full text-left px-3 py-1.5 text-sm text-white hover:bg-sg-accent/20 transition-colors'

type Props = {
  category: string
  onClose: () => void
}

/** Dice + deck wildcard actions shared by Sidebar and StyleGrid category menus. */
export function WildcardMenuItems({ category, onClose }: Props) {
  return (
    <>
      <button
        type="button"
        className={MENU_BTN}
        onClick={() => {
          sendToHost({
            type: 'SG_WILDCARD_CATEGORY',
            category,
          })
          onClose()
        }}
      >
        🎲 Add category as wildcard
      </button>
      <button
        type="button"
        className={MENU_BTN}
        onClick={() => {
          useStylesStore.getState().startSliceMode(category)
          onClose()
        }}
      >
        🎲 Select styles for wildcard...
      </button>
      <button
        type="button"
        className={MENU_BTN}
        onClick={() => {
          sendToHost({
            type: 'SG_WILDCARD_CATEGORY',
            category,
            kind: WILDCARD_KIND_DECK,
          })
          onClose()
        }}
      >
        🃏 Add category as deck wildcard
      </button>
      <button
        type="button"
        className={MENU_BTN}
        onClick={() => {
          useStylesStore.getState().startSliceMode(category, WILDCARD_KIND_DECK)
          onClose()
        }}
      >
        🃏 Select styles for deck wildcard...
      </button>
    </>
  )
}
