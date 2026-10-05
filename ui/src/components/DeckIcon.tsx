import { Spade } from 'lucide-react'

type Props = {
  className?: string
}

const DEFAULT_CLASS = 'h-4 w-4 inline-block align-text-bottom shrink-0'

export function DeckIcon({ className = DEFAULT_CLASS }: Props) {
  return <Spade className={className} aria-hidden />
}
