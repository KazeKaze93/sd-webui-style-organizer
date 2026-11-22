/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Star } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host?.remove()
    host = null
  })

  it('status region with icon box, h2 title, hint and action buttons', async () => {
    const primary = vi.fn()
    await act(async () => {
      root!.render(
        <EmptyState
          icon={Star}
          tone="accent"
          title="No favorites yet"
          hint="A hint"
          actions={[
            { label: 'Go', variant: 'primary', onClick: primary },
            { label: 'Other', variant: 'secondary', onClick: () => {} },
          ]}
        />,
      )
    })
    const el = host!.querySelector<HTMLElement>('[role="status"]')!
    // Appearing does not move focus.
    expect(document.activeElement).toBe(document.body)
    expect(el.className).toContain('flex-1')
    expect(el.className).toContain('min-h-[220px]')
    const box = el.querySelector<HTMLElement>('[data-sg-empty-icon="accent"]')!
    expect(box.className).toContain('h-[52px]')
    expect(box.className).toContain('rounded-[14px]')
    const svg = box.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('24')
    expect(svg.getAttribute('stroke-width')).toBe('1.8')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('class')).toContain('text-sg-accent-text')
    expect(el.querySelector('h2')!.className).toContain('text-base')
    expect(el.querySelector('p')!.className).toContain('max-w-[300px]')
    const [go, other] = [...el.querySelectorAll<HTMLButtonElement>('button')]
    expect(go.className).toContain('border-sg-accent')
    expect(go.className).toContain('bg-sg-accent/[0.18]')
    expect(go.className).toContain('h-8')
    expect(other.className).toContain('border-sg-border')
    expect(other.className).toContain('bg-transparent')
    await act(async () => go.click())
    expect(primary).toHaveBeenCalledOnce()
  })

  it('muted tone and no hint / actions', async () => {
    await act(async () => {
      root!.render(<EmptyState icon={Star} title="Nothing" />)
    })
    expect(host!.querySelector('[data-sg-empty-icon="muted"] svg')!.getAttribute('class')).toContain('text-sg-muted')
    expect(host!.querySelector('p')).toBeNull()
    expect(host!.querySelectorAll('button')).toHaveLength(0)
  })
})
