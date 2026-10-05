import type { WildcardKind } from '../bridge'
import { WILDCARD_KIND_DICE } from '../bridge'

/** Stable identity for a wildcard chip / preset entry (category + spec + kind). */
export function wildcardKey(
  category: string,
  spec: string | undefined,
  kind?: WildcardKind,
): string {
  const k = kind ?? WILDCARD_KIND_DICE
  return `${String(category || '').toLowerCase()}\0${String(spec ?? '').toLowerCase()}\0${k}`
}
