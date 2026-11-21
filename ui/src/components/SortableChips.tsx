import { useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useLayer } from '../lib/layerStack'

/**
 * A pointer drag starts only after the pointer travels this far, so a click on
 * a chip (or on its remove button) is never taken for a drag.
 */
export const CHIP_DRAG_ACTIVATION_DISTANCE_PX = 6

const SCREEN_READER_INSTRUCTIONS = {
  draggable:
    'To reorder, press Space or Enter to pick the chip up, move it with the arrow keys, ' +
    'then press Space or Enter to drop it, or Escape to cancel. Press Delete to remove the chip.',
}

type SortableChipsProps<T> = {
  items: readonly T[]
  getId: (item: T) => string
  /** Spoken name of a chip (also its aria-label). */
  getLabel: (item: T) => string
  /** Spoken name of the list, e.g. "selected styles". */
  listLabel: string
  onReorder: (next: T[]) => void
  onRemove: (item: T) => void
  chipClassName: (item: T) => string
  chipTitle?: (item: T) => string | undefined
  renderChip: (item: T) => ReactNode
  className?: string
}

type ChipProps = {
  id: string
  label: string
  title?: string
  className: string
  onRemove: () => void
  children: ReactNode
}

function SortableChip({ id, label, title, className, onRemove, children }: ChipProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    // The chip holds a real <button> (remove), so it must not be a button itself.
    attributes: { role: 'group', roleDescription: 'sortable chip' },
  })

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isDragging) {
      e.preventDefault()
      e.stopPropagation()
      onRemove()
      return
    }
    listeners?.onKeyDown?.(e)
  }

  return (
    <span
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      aria-label={label}
      title={title}
      data-sg-chip={id}
      data-dragging={isDragging ? 'true' : undefined}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 50 : undefined,
        touchAction: 'none',
      }}
      className={`${className} ${isDragging ? 'cursor-grabbing shadow-lg' : 'cursor-grab'}`}
    >
      {children}
    </span>
  )
}

/**
 * Wrapping row of chips that can be reordered by pointer or keyboard.
 * Replaces framer-motion `Reorder`, which only works along one axis and breaks
 * as soon as the chips wrap to a second row.
 */
export function SortableChips<T>({
  items,
  getId,
  getLabel,
  listLabel,
  onReorder,
  onRemove,
  chipClassName,
  chipTitle,
  renderChip,
  className,
}: SortableChipsProps<T>) {
  const [dragging, setDragging] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: CHIP_DRAG_ACTIVATION_DISTANCE_PX },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Escape belongs to the layer stack (App handles it in the capture phase and
  // would close the panel). While a chip is held, Escape cancels the drag
  // instead: both dnd-kit sensors cancel on a window `visibilitychange`.
  useLayer(dragging, () => {
    window.dispatchEvent(new Event('visibilitychange'))
  })

  const ids = items.map(getId)
  const position = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1
  const labelOf = (id: UniqueIdentifier) => {
    const item = items.find((it) => getId(it) === String(id))
    return item ? getLabel(item) : 'chip'
  }

  const announcements: Announcements = {
    onDragStart({ active }) {
      return `Picked up ${labelOf(active.id)}. Position ${position(active.id)} of ${ids.length} in ${listLabel}.`
    },
    onDragOver({ active, over }) {
      if (!over) return `${labelOf(active.id)} is not over a drop position.`
      return `${labelOf(active.id)} moved to position ${position(over.id)} of ${ids.length}.`
    },
    onDragEnd({ active, over }) {
      if (!over || over.id === active.id) {
        return `${labelOf(active.id)} dropped at its original position ${position(active.id)} of ${ids.length}.`
      }
      return `${labelOf(active.id)} dropped at position ${position(over.id)} of ${ids.length} in ${listLabel}.`
    },
    onDragCancel({ active }) {
      return `Reordering cancelled. ${labelOf(active.id)} returned to position ${position(active.id)} of ${ids.length}.`
    },
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(false)
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onReorder(arrayMove([...items], from, to))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
      onDragStart={() => setDragging(true)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(false)}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className={className} role="list" aria-label={listLabel}>
          {items.map((item) => {
            const id = getId(item)
            return (
              <SortableChip
                key={id}
                id={id}
                label={getLabel(item)}
                title={chipTitle?.(item)}
                className={chipClassName(item)}
                onRemove={() => onRemove(item)}
              >
                {renderChip(item)}
              </SortableChip>
            )
          })}
        </div>
      </SortableContext>
    </DndContext>
  )
}
