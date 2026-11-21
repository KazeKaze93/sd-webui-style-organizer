/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost, WILDCARD_KIND_DECK, WILDCARD_KIND_DICE } from '../bridge'
import { LORA_VIEW, useStylesStore } from '../store/stylesStore'
import { CategoryMenuItems } from './CategoryMenuItems'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

describe('CategoryMenuItems', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let onClose: ReturnType<typeof vi.fn<() => void>>

  const items = () => [...host!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  const item = (title: string) => items().find((b) => b.textContent?.startsWith(title))!
  const render = async (category: string, lora?: boolean) => {
    await act(async () => {
      root!.render(
        <div role="menu">
          <CategoryMenuItems category={category} onClose={onClose} lora={lora} />
        </div>,
      )
    })
  }

  beforeEach(() => {
    vi.mocked(sendToHost).mockClear()
    onClose = vi.fn<() => void>()
    localStorage.clear()
    useStylesStore.setState({ activeSource: null, sliceMode: null, sliceSelection: [] })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host?.remove()
    host = null
    useStylesStore.setState({ sliceMode: null })
  })

  it('heading, two-line items with 15 px icons and the 40 px minimum', async () => {
    await render('BODY')
    const heading = host!.querySelector('[aria-hidden]')!
    expect(heading.textContent).toBe('Wildcard from BODY')
    expect(heading.className).toContain('uppercase')
    expect(heading.className).toContain('tracking-wide')
    for (const title of ['Random', 'Shuffle', 'Pick styles…']) {
      expect(item(title).className).toContain('min-h-[40px]')
      expect(item(title).querySelector('svg')!.getAttribute('class')).toContain('h-[15px]')
      expect(item(title).querySelector('span.text-xs.text-sg-muted')).not.toBeNull()
    }
  })

  it('Random sends the whole-category dice wildcard', async () => {
    await render('BODY')
    await act(async () => item('Random').click())
    expect(sendToHost).toHaveBeenCalledWith({ type: 'SG_WILDCARD_CATEGORY', category: 'BODY' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Shuffle sends the whole-category deck wildcard', async () => {
    await render('BODY')
    await act(async () => item('Shuffle').click())
    expect(sendToHost).toHaveBeenCalledWith({ type: 'SG_WILDCARD_CATEGORY', category: 'BODY', kind: WILDCARD_KIND_DECK })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Pick styles… opens slice mode in Random and sends nothing', async () => {
    await render('BODY')
    await act(async () => item('Pick styles…').click())
    expect(useStylesStore.getState().sliceMode).toEqual({ category: 'BODY', kind: WILDCARD_KIND_DICE })
    expect(sendToHost).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Generate previews… uses the active source', async () => {
    useStylesStore.setState({ activeSource: 'webui/a.csv' })
    await render('BODY')
    await act(async () => item('Generate previews…').click())
    expect(sendToHost).toHaveBeenCalledWith({
      type: 'SG_GENERATE_CATEGORY_PREVIEWS',
      category: 'BODY',
      missingCount: 0,
      source: 'webui/a.csv',
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Generate previews… falls back to sg_v2_last_source, then to no source', async () => {
    localStorage.setItem('sg_v2_last_source', 'webui/last.csv')
    await render('POSE')
    await act(async () => item('Generate previews…').click())
    expect(sendToHost).toHaveBeenLastCalledWith({
      type: 'SG_GENERATE_CATEGORY_PREVIEWS',
      category: 'POSE',
      missingCount: 0,
      source: 'webui/last.csv',
    })
    localStorage.clear()
    await act(async () => item('Generate previews…').click())
    expect(sendToHost).toHaveBeenLastCalledWith({ type: 'SG_GENERATE_CATEGORY_PREVIEWS', category: 'POSE', missingCount: 0 })
  })

  it.each([
    ['the LoRA aggregate', 'LoRA', undefined],
    ['the LoRA view id', LORA_VIEW, undefined],
    ['a LoRA folder category', 'characters', true],
  ])('no Generate previews for %s', async (_label, category, lora) => {
    await render(category, lora)
    expect(items().map((b) => b.querySelector('span.text-sm')?.textContent ?? b.textContent)).toEqual([
      'Random',
      'Shuffle',
      'Pick styles…',
    ])
    expect(host!.querySelector('.border-t')).toBeNull()
  })
})
