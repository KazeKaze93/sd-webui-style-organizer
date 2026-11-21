import { LayoutGrid, LayoutList } from 'lucide-react'
import { useStylesStore, type ViewMode } from '../store/stylesStore'
import { SegmentedControl, type SegmentOption } from './SegmentedControl'

const OPTIONS: ReadonlyArray<SegmentOption<ViewMode>> = [
  { value: 'grid', label: 'Grid', icon: LayoutList, data: { 'data-sg-view-mode': 'grid' } },
  { value: 'gallery', label: 'Gallery', icon: LayoutGrid, data: { 'data-sg-view-mode': 'gallery' } },
]

/** Grid / Gallery switch in the header. Needs a TooltipProvider above it. */
export function ViewModeToggle() {
  const viewMode = useStylesStore((s) => s.viewMode)
  const setViewMode = useStylesStore((s) => s.setViewMode)
  return (
    <SegmentedControl
      options={OPTIONS}
      value={viewMode}
      onChange={setViewMode}
      ariaLabel="View"
      data={{ 'data-sg-view-toggle': 'true' }}
    />
  )
}
