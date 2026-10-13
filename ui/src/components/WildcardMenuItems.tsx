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
import { MenuItem } from './ViewportFixedMenu'

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
        <MenuItem
          onSelect={() => {
            sendToHost({
              type: 'SG_WILDCARD_CATEGORY',
              category,
            })
            onClose()
          }}
        >
          🎲 {MENU_WHOLE_CATEGORY}
        </MenuItem>
        <MenuItem
          onSelect={() => {
            useStylesStore.getState().startSliceMode(category)
            onClose()
          }}
        >
          🎲 {MENU_PICK_STYLES}
        </MenuItem>
      </div>
      <MenuDivider />
      <div role="group" aria-label={MENU_GROUP_SHUFFLE}>
        <div className={MENU_HEADING} aria-hidden>
          {MENU_GROUP_SHUFFLE}
        </div>
        <MenuItem
          onSelect={() => {
            sendToHost({
              type: 'SG_WILDCARD_CATEGORY',
              category,
              kind: WILDCARD_KIND_DECK,
            })
            onClose()
          }}
        >
          <DeckIcon /> {MENU_WHOLE_CATEGORY}
        </MenuItem>
        <MenuItem
          onSelect={() => {
            useStylesStore.getState().startSliceMode(category, WILDCARD_KIND_DECK)
            onClose()
          }}
        >
          <DeckIcon /> {MENU_PICK_STYLES}
        </MenuItem>
      </div>
    </>
  )
}
