/**
 * Focus / DOM probes for keyboard E2E (bench-only).
 */

/**
 * @param {import('playwright').Frame} frame
 */
export async function describeActive(frame) {
  return frame.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body || el === document.documentElement) {
      return {
        tag: el?.tagName || 'NONE',
        kind: 'body',
        inGrid: false,
        inGridCell: false,
        isHeaderCell: false,
        isBody: true,
        title: '',
        role: null,
        tabIndex: el?.tabIndex ?? null,
        text: '',
      }
    }

    const grid = el.closest('[role="grid"], [data-sg-item-count]')
    const card = el.closest('[data-sg-card="true"]')
    const header = el.closest('[data-sg-category-header]')
    const dialog = el.closest('[role="dialog"]')
    const menu =
      el.closest('[role="menu"]') ||
      el.closest('[data-sg-menu]') ||
      (() => {
        // ViewportFixedMenu portal: fixed panel under body with buttons
        const fixed = el.closest('body > div.fixed')
        if (!fixed) return null
        const r = fixed.getBoundingClientRect()
        if (r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2) return null
        return fixed
      })()

    let kind = 'other'
    if (dialog) kind = 'dialog'
    else if (menu) kind = 'menu'
    else if (card) kind = 'card'
    else if (header && el.closest('button')) kind = 'header-action'
    else if (header) kind = 'header'
    else if (grid) kind = 'grid'
    else if (el.matches('input[placeholder="Search styles..."]')) kind = 'search'
    else if (el.matches('input, textarea, select, button, a[href]')) kind = 'control'

    // Composite grid cell (roving tabindex target) — not incidental Select All buttons.
    const inGridCell =
      kind === 'card' ||
      kind === 'header' ||
      kind === 'header-action' ||
      el.getAttribute('role') === 'gridcell' ||
      Boolean(el.closest('[role="gridcell"]'))

    const title = card
      ? (card.getAttribute('title') || '').split('\n')[0]
      : header
        ? header.getAttribute('data-sg-category-header') || ''
        : ''

    return {
      tag: el.tagName,
      kind,
      inGrid: Boolean(grid),
      inGridCell,
      isHeaderCell: Boolean(header),
      isBody: false,
      title,
      role: el.getAttribute('role'),
      tabIndex: el.tabIndex,
      text: (el.textContent || '').trim().slice(0, 80),
      ariaLabel: el.getAttribute('aria-label') || '',
      cellRow: el.getAttribute('data-cell-row'),
      cellCol: el.getAttribute('data-cell-col'),
    }
  })
}

/**
 * @param {import('playwright').Frame} frame
 */
export async function selectedCount(frame) {
  return frame.evaluate(() => {
    const saveBtn = [...document.querySelectorAll('button')].find((b) =>
      /Save set\s*\((\d+)\)/.test(b.textContent || ''),
    )
    if (saveBtn) {
      const m = (saveBtn.textContent || '').match(/Save set\s*\((\d+)\)/)
      if (m) return Number(m[1])
    }
    // Fallback: selected chrome on cards (accent border class)
    const cards = [...document.querySelectorAll('[data-sg-card="true"]')]
    let n = 0
    for (const c of cards) {
      if (/\bborder-sg-accent\b/.test(c.className) && /\bbg-sg-accent\//.test(c.className)) {
        n += 1
      }
    }
    return n
  })
}

/**
 * @param {import('playwright').Frame} frame
 */
export async function focusedCellVisible(frame) {
  return frame.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) {
      return { ok: false, reason: 'activeElement is body/none' }
    }
    const target =
      el.closest('[data-sg-card="true"]') ||
      el.closest('[data-sg-category-header]') ||
      el
    const rect = target.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) {
      return { ok: false, reason: 'focused cell has zero size (likely unmounted)' }
    }

    let scroller = null
    let node = target.parentElement
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node)
      const oy = style.overflowY
      if (
        (oy === 'auto' || oy === 'scroll') &&
        node.scrollHeight > node.clientHeight + 8
      ) {
        scroller = node
        break
      }
      node = node.parentElement
    }

    if (!scroller) {
      const vh = window.innerHeight
      const vw = window.innerWidth
      const visible =
        rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw
      return {
        ok: visible,
        reason: visible ? 'visible in viewport' : 'outside viewport',
        rect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right },
      }
    }

    const sr = scroller.getBoundingClientRect()
    const visible =
      rect.bottom > sr.top + 1 &&
      rect.top < sr.bottom - 1 &&
      rect.right > sr.left + 1 &&
      rect.left < sr.right - 1
    return {
      ok: visible,
      reason: visible ? 'visible in scroller' : 'outside scroller viewport',
      rect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right },
      scroller: { top: sr.top, bottom: sr.bottom, height: sr.height },
    }
  })
}

/**
 * @param {import('playwright').Frame} frame
 */
export async function findOpenMenu(frame) {
  return frame.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const roleMenu = document.querySelector('[role="menu"]')
    if (roleMenu) {
      const r = roleMenu.getBoundingClientRect()
      const overflow = {
        left: Math.max(0, 0 - r.left),
        top: Math.max(0, 0 - r.top),
        right: Math.max(0, r.right - vw),
        bottom: Math.max(0, r.bottom - vh),
      }
      return {
        found: true,
        via: 'role=menu',
        buttonCount: roleMenu.querySelectorAll('[role="menuitem"], button').length,
        inViewport:
          overflow.left === 0 &&
          overflow.top === 0 &&
          overflow.right === 0 &&
          overflow.bottom === 0,
        overflow,
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      }
    }

    const candidates = [...document.body.querySelectorAll(':scope > div.fixed')].filter((el) => {
      const cs = getComputedStyle(el)
      if (cs.position !== 'fixed') return false
      const r = el.getBoundingClientRect()
      if (r.width >= vw - 2 && r.height >= vh - 2) return false
      if (r.width < 40 || r.height < 20) return false
      const z = Number(cs.zIndex) || 0
      return z >= 9999 && z < 10005
    })
    candidates.sort((a, b) => {
      const za = Number(getComputedStyle(a).zIndex) || 0
      const zb = Number(getComputedStyle(b).zIndex) || 0
      return zb - za
    })
    const menu = candidates[0]
    if (!menu) return { found: false }

    const r = menu.getBoundingClientRect()
    const overflow = {
      left: Math.max(0, 0 - r.left),
      top: Math.max(0, 0 - r.top),
      right: Math.max(0, r.right - vw),
      bottom: Math.max(0, r.bottom - vh),
    }
    return {
      found: true,
      via: 'fixed-portal',
      buttonCount: menu.querySelectorAll('button').length,
      inViewport:
        overflow.left === 0 &&
        overflow.top === 0 &&
        overflow.right === 0 &&
        overflow.bottom === 0,
      overflow,
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    }
  })
}

/**
 * @param {import('playwright').Frame} frame
 */
export async function findOpenDialog(frame) {
  return frame.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]')
    if (!dlg) return { found: false }
    const r = dlg.getBoundingClientRect()
    return {
      found: true,
      visible: r.width > 2 && r.height > 2,
      title: (dlg.getAttribute('aria-labelledby')
        ? document.getElementById(dlg.getAttribute('aria-labelledby') || '')?.textContent
        : dlg.textContent || ''
      )
        ?.trim()
        .slice(0, 60),
    }
  })
}

/**
 * @param {import('playwright').Frame} frame
 */
export async function searchValue(frame) {
  return frame.evaluate(() => {
    const input = document.querySelector('input[placeholder="Search styles..."]')
    return input instanceof HTMLInputElement ? input.value : null
  })
}

/**
 * Focus search without Playwright actionability (survives odd overlay states).
 * @param {import('playwright').Frame} frame
 */
export async function focusSearch(frame) {
  return frame.evaluate(() => {
    const input = document.querySelector('input[placeholder="Search styles..."]')
    if (!(input instanceof HTMLInputElement)) return { ok: false, reason: 'search input missing from DOM' }
    input.focus()
    return { ok: document.activeElement === input, reason: document.activeElement === input ? 'ok' : 'focus rejected' }
  })
}

/**
 * @param {import('playwright').Page} page
 */
export async function resetCloseCounter(page) {
  await page.evaluate(() => {
    window.__KEYS_CLOSE__ = { count: 0, lastAt: null }
  })
}

/**
 * @param {import('playwright').Page} page
 */
export async function installCloseListener(page) {
  await page.evaluate(() => {
    if (window.__KEYS_CLOSE_LISTENER__) return
    window.__KEYS_CLOSE__ = { count: 0, lastAt: null }
    window.__KEYS_CLOSE_LISTENER__ = (event) => {
      const data = event.data
      if (!data || data.type !== 'SG_CLOSE_REQUEST') return
      window.__KEYS_CLOSE__.count += 1
      window.__KEYS_CLOSE__.lastAt = Date.now()
    }
    window.addEventListener('message', window.__KEYS_CLOSE_LISTENER__)
  })
}

/**
 * @param {import('playwright').Page} page
 */
export async function closeCount(page) {
  return page.evaluate(() => window.__KEYS_CLOSE__?.count ?? 0)
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 * @param {string} key
 * @param {{ delay?: number }} [opts]
 */
export async function press(page, frame, key, opts = {}) {
  // Ensure iframe document has keyboard focus before sending keys.
  await frame.evaluate(() => {
    if (document.activeElement === document.body || !document.activeElement) {
      const root = document.getElementById('root')
      if (root instanceof HTMLElement && root.tabIndex < 0) root.tabIndex = -1
      root?.focus?.({ preventScroll: true })
    }
  })
  await page.keyboard.press(key, opts.delay != null ? { delay: opts.delay } : undefined)
}

/**
 * Tab through focusables; return sequence of describeActive snapshots.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 * @param {number} steps
 */
export async function tabTrail(page, frame, steps) {
  /** @type {Awaited<ReturnType<typeof describeActive>>[]} */
  const trail = []
  for (let i = 0; i < steps; i += 1) {
    await press(page, frame, 'Tab')
    trail.push(await describeActive(frame))
  }
  return trail
}

/**
 * Attempt to put focus on a grid card via existing focusability (no tabindex injection).
 * Falls back to clicking the card (may toggle selection) then checking focus — expected FAIL today.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 */
export async function tryFocusFirstCard(page, frame) {
  /**
   * From a focused grid cell, ArrowDown until a card (roving cell may start on a header).
   * @returns {Promise<{ ok: boolean, snap: object, via: string }>}
   */
  async function arrowToCard(via) {
    let snap = await describeActive(frame)
    if (snap.kind === 'card') return { ok: true, snap, via }
    for (let j = 0; j < 24; j += 1) {
      await press(page, frame, 'ArrowDown')
      snap = await describeActive(frame)
      if (snap.kind === 'card') return { ok: true, snap, via: `${via}+ArrowDown` }
      if (!snap.inGrid) break
    }
    return { ok: false, snap, via: `${via}+ArrowDown` }
  }

  // Prefer Tab into grid from search.
  const search = await focusSearch(frame)
  if (!search.ok) {
    return { ok: false, snap: await describeActive(frame), via: `search:${search.reason}` }
  }
  for (let i = 0; i < 30; i += 1) {
    await press(page, frame, 'Tab')
    const snap = await describeActive(frame)
    if (snap.kind === 'card') return { ok: true, snap, via: 'Tab' }
    if (snap.inGridCell) {
      const moved = await arrowToCard('Tab')
      if (moved.ok) return moved
    }
  }

  // Direct focus on first mounted card button (prod cards are <button tabindex>).
  await frame.evaluate(() => {
    const card = document.querySelector('[data-sg-card="true"]')
    if (card instanceof HTMLElement) card.focus()
  })
  const snap = await describeActive(frame)
  if (snap.kind === 'card') return { ok: true, snap, via: 'focus()' }
  if (snap.inGridCell) return arrowToCard('focus()')
  return { ok: false, snap, via: 'focus()' }
}

/**
 * Clear search input + store (setup for Escape layering).
 * @param {import('playwright').Frame} frame
 */
export async function clearSearch(frame) {
  return frame.evaluate(() => {
    const input = document.querySelector('input[placeholder="Search styles..."]')
    if (!(input instanceof HTMLInputElement)) return { ok: false }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, value: input.value }
  })
}

/**
 * Open card context menu via mouse (setup when keyboard menu open is absent).
 * @param {import('playwright').Frame} frame
 */
export async function openCardContextMenuMouse(frame) {
  return frame.evaluate(() => {
    const card = document.querySelector('[data-sg-card="true"]')
    if (!card) return { ok: false, reason: 'no card in DOM' }
    const r = card.getBoundingClientRect()
    const x = r.left + Math.min(12, r.width / 2)
    const y = r.top + Math.min(12, r.height / 2)
    card.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 2,
        view: window,
      }),
    )
    return { ok: true, x, y }
  })
}

/**
 * Collapse the first visible category header via mouse (setup only).
 * @param {import('playwright').Frame} frame
 */
export async function collapseFirstHeader(frame) {
  return frame.evaluate(() => {
    const header = document.querySelector('[data-sg-category-header]')
    if (!header) return { ok: false, category: null }
    const cat = header.getAttribute('data-sg-category-header')
    const collapsed = (header.textContent || '').includes('▶')
    if (!collapsed) {
      const toggle =
        header.querySelector('button[aria-expanded]') ||
        header.querySelector('[data-cell-col="0"]') ||
        header
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    }
    return { ok: true, category: cat }
  })
}

/**
 * Open Save set dialog (requires ≥1 selected). Selects first card via click if needed.
 * @param {import('playwright').Frame} frame
 */
export async function ensureSaveSetDialogOpen(frame) {
  const count = await selectedCount(frame)
  if (count < 1) {
    await frame.evaluate(() => {
      const card = document.querySelector('[data-sg-card="true"]')
      card?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    })
  }
  const opened = await frame.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /Save set\s*\(\d+\)/.test(b.textContent || ''),
    )
    if (!(btn instanceof HTMLButtonElement)) return { ok: false, reason: 'Save set button missing' }
    // Focus before open so useFocusTrap can restore to the trigger.
    btn.focus()
    btn.click()
    return { ok: true }
  })
  return opened
}

/**
 * Ensure ≥1 selected so BottomPanel / SelectedBar expose post-grid tab stops.
 * @param {import('playwright').Frame} frame
 */
export async function ensureSomethingSelected(frame) {
  const n = await selectedCount(frame)
  if (n > 0) return { ok: true, count: n }
  await frame.evaluate(() => {
    const card = document.querySelector('[data-sg-card="true"]')
    card?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  })
  const after = await selectedCount(frame)
  return { ok: after > 0, count: after }
}

/**
 * Dismiss menus/dialogs best-effort (backdrop first — avoids SG_CLOSE_REQUEST).
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 */
export async function dismissOverlays(page, frame) {
  void page
  for (let i = 0; i < 8; i += 1) {
    const state = await frame.evaluate(() => {
      // Prefer explicit Cancel on dialogs so layer stack unregisters cleanly.
      for (const dlg of document.querySelectorAll('[role="dialog"]')) {
        const cancel = [...dlg.querySelectorAll('button')].find((b) =>
          /cancel/i.test(b.textContent || ''),
        )
        if (cancel) cancel.click()
      }
      const backdrops = [...document.body.querySelectorAll(':scope > div.fixed')].filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2
      })
      for (const b of backdrops) b.click()
      document.body.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: 2,
          clientY: 2,
          view: window,
        }),
      )
      return {
        dialog: Boolean(document.querySelector('[role="dialog"]')),
        menu: [...document.body.querySelectorAll(':scope > div.fixed')].some((el) => {
          const r = el.getBoundingClientRect()
          const cs = getComputedStyle(el)
          if (cs.position !== 'fixed') return false
          if (r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2) return false
          return r.width >= 40 && r.height >= 20
        }),
        roleMenu: Boolean(document.querySelector('[role="menu"]')),
      }
    })
    if (!state.dialog && !state.menu && !state.roleMenu) break
    await new Promise((r) => setTimeout(r, 40))
  }
}
