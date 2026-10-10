import { sendToHost, WILDCARD_KIND_DECK } from '../bridge'
import {
  MENU_GROUP_RANDOM,
  MENU_GROUP_SHUFFLE,
  MENU_PICK_STYLES,
  MENU_WHOLE_CATEGORY,
} from '../lib/wildcardLabels'
import { useStylesStore } from '../store/stylesStore'
import { DeckIcon } from './DeckIcon'
import { MenuDivider } from './MenuDivider'

const MENU_BTN =
  'w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors'

const MENU_HEADING = 'text-xs text-sg-muted px-3 pt-1.5'

type Props = {
  category: string
  onClose: () => void
}

/** Dice + deck wildcard actions shared by Sidebar and StyleGrid category menus. */
export function WildcardMenuItems({ category, onClose }: Props) {
  return (
    <>
      <div role="group" aria-label={MENU_GROUP_RANDOM}>
        <div className={MENU_HEADING} aria-hidden>
          {MENU_GROUP_RANDOM}
        </div>
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
          🎲 {MENU_WHOLE_CATEGORY}
        </button>
        <button
          type="button"
          className={MENU_BTN}
          onClick={() => {
            useStylesStore.getState().startSliceMode(category)
            onClose()
          }}
        >
          🎲 {MENU_PICK_STYLES}
        </button>
      </div>
      <MenuDivider />
      <div role="group" aria-label={MENU_GROUP_SHUFFLE}>
        <div className={MENU_HEADING} aria-hidden>
          {MENU_GROUP_SHUFFLE}
        </div>
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
          <DeckIcon /> {MENU_WHOLE_CATEGORY}
        </button>
        <button
          type="button"
          className={MENU_BTN}
          onClick={() => {
            useStylesStore.getState().startSliceMode(category, WILDCARD_KIND_DECK)
            onClose()
          }}
        >
          <DeckIcon /> {MENU_PICK_STYLES}
        </button>
      </div>
    </>
  )
}
