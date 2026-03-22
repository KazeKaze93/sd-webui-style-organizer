import { useStylesStore } from '../store/stylesStore'
import { StyleCard } from './StyleCard'

export function StyleGrid() {
  const { filteredStyles } = useStylesStore()
  const styles = filteredStyles()

  if (styles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sg-muted text-sm">
        No styles found
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] 
                    gap-2 content-start">
      {styles.map(style => (
        <StyleCard key={style.name} style={style} />
      ))}
    </div>
  )
}
