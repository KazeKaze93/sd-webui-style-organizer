import type { ReactNode } from 'react'
import { Dices, Image, ListChecks } from 'lucide-react'
import { sendToHost, WILDCARD_KIND_DECK } from '../bridge'
import {
  MENU_GENERATE_PREVIEWS,
  MENU_HEADING_PREFIX,
  MENU_PICK_STYLES,
  MENU_PICK_STYLES_SUB,
  MENU_RANDOM,
  MENU_RANDOM_SUB,
  MENU_SHUFFLE,
  MENU_SHUFFLE_SUB,
} from '../lib/wildcardLabels'
import { LORA_VIEW, useStylesStore } from '../store/stylesStore'
import { DeckIcon } from './DeckIcon'
import { MenuDivider } from './MenuDivider'
import { MenuItem } from './ViewportFixedMenu'

const ICON_CLASS = 'h-[15px] w-[15px] shrink-0'

type Props = {
  category: string
  onClose: () => void
  /** A LoRA folder category (grid headers in the LoRA view): no preview generation. */
  lora?: boolean
}

/** Title + muted subtitle, icon on the left; at least 40 px tall. */
function TwoLineItem({
  icon,
  title,
  subtitle,
  onSelect,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  onSelect: () => void
}) {
  return (
    <MenuItem className="flex items-center gap-2 min-h-[40px]" onSelect={onSelect}>
      {icon}
      <span className="flex flex-col">
        <span className="text-sm">{title}</span>
        <span className="text-xs text-sg-muted">{subtitle}</span>
      </span>
    </MenuItem>
  )
}

/** LoRA rows have no SD-generated previews. */
function isLoraCategory(category: string) {
  return category === 'LoRA' || category === LORA_VIEW
}

/** Category menu shared by the sidebar rows and the LoRA grid headers. */
export function CategoryMenuItems({ category, onClose, lora = false }: Props) {
  return (
    <>
      <div className="text-xs uppercase tracking-wide text-sg-muted px-3 pt-1.5 pb-0.5" aria-hidden>
        {MENU_HEADING_PREFIX}
        {category}
      </div>
      <TwoLineItem
        icon={<Dices className={ICON_CLASS} aria-hidden />}
        title={MENU_RANDOM}
        subtitle={MENU_RANDOM_SUB}
        onSelect={() => {
          sendToHost({ type: 'SG_WILDCARD_CATEGORY', category })
          onClose()
        }}
      />
      <TwoLineItem
        icon={<DeckIcon className={ICON_CLASS} />}
        title={MENU_SHUFFLE}
        subtitle={MENU_SHUFFLE_SUB}
        onSelect={() => {
          sendToHost({ type: 'SG_WILDCARD_CATEGORY', category, kind: WILDCARD_KIND_DECK })
          onClose()
        }}
      />
      <TwoLineItem
        icon={<ListChecks className={ICON_CLASS} aria-hidden />}
        title={MENU_PICK_STYLES}
        subtitle={MENU_PICK_STYLES_SUB}
        onSelect={() => {
          useStylesStore.getState().startSliceMode(category)
          onClose()
        }}
      />
      {!lora && !isLoraCategory(category) && (
        <>
          <MenuDivider />
          <MenuItem
            className="flex items-center gap-2"
            onSelect={() => {
              const rawSrc =
                useStylesStore.getState().activeSource ??
                (typeof localStorage !== 'undefined' ? localStorage.getItem('sg_v2_last_source') : null)
              sendToHost({
                type: 'SG_GENERATE_CATEGORY_PREVIEWS',
                category,
                missingCount: 0,
                ...(rawSrc ? { source: rawSrc } : {}),
              })
              onClose()
            }}
          >
            <Image className={ICON_CLASS} aria-hidden />
            {MENU_GENERATE_PREVIEWS}
          </MenuItem>
        </>
      )}
    </>
  )
}
