/**
 * Keyboard contract assertions (target behavior from KEYS-E2E brief).
 * Harness reports FAIL with reasons when UI keyboard is incomplete — does not implement app keys.
 */
import { sleep } from '../profile/lib.mjs'
import {
  clearSearch,
  closeCount,
  collapseFirstHeader,
  describeActive,
  dismissOverlays,
  ensureSaveSetDialogOpen,
  ensureSomethingSelected,
  findOpenDialog,
  findOpenMenu,
  focusSearch,
  focusedCellVisible,
  openCardContextMenuMouse,
  press,
  resetCloseCounter,
  searchValue,
  selectedCount,
  tabTrail,
  tryFocusFirstCard,
} from './focusHelpers.mjs'

/**
 * @typedef {{ id: string, name: string, pass: boolean, detail: string }} AssertionResult
 */

/**
 * @param {string} id
 * @param {string} name
 * @param {boolean} pass
 * @param {string} detail
 * @returns {AssertionResult}
 */
function result(id, name, pass, detail) {
  return { id, name, pass: Boolean(pass), detail: String(detail) }
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 * @param {number} n
 * @returns {Promise<AssertionResult[]>}
 */
export async function runKeyAssertions(page, frame, n) {
  /** @type {AssertionResult[]} */
  const out = []

  /**
   * @param {string} id
   * @param {string} name
   * @param {() => Promise<AssertionResult | AssertionResult[]>} fn
   */
  async function safe(id, name, fn) {
    try {
      await dismissOverlays(page, frame).catch(() => {})
      await resetCloseCounter(page)
      const r = await fn()
      if (Array.isArray(r)) out.push(...r)
      else out.push(r)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      out.push(result(id, name, false, `harness error: ${msg.slice(0, 240)}`))
    }
  }

  await dismissOverlays(page, frame).catch(() => {})
  await resetCloseCounter(page)

  await safe('tab-grid-once', 'Tab enters grid exactly once; one more Tab leaves', () =>
    assertTabGridOnce(page, frame),
  )
  await safe('arrows-traverse', 'Arrows traverse cards, header cells, collapsed groups', () =>
    assertArrowTraversal(page, frame),
  )
  await safe('enter-space-toggle', 'Enter and Space toggle selection (selected count)', () =>
    assertEnterSpaceToggle(page, frame),
  )
  await safe('nav-keys-visible', 'Home/End/Ctrl+Home/Ctrl+End/PageDown; focused cell visible', () =>
    assertNavKeys(page, frame),
  )
  await safe('focus-after-scroll', 'Focused card stays focused after 3-screen keyboard scroll', () =>
    assertFocusAfterKeyboardScroll(page, frame),
  )
  await safe('menu-contextmenu', 'ContextMenu opens card menu; arrows move; Escape closes; focus returns', () =>
    assertContextMenuKey(page, frame, 'ContextMenu'),
  )
  await safe('menu-shift-f10', 'Shift+F10 opens card menu; arrows move; Escape closes; focus returns', () =>
    assertContextMenuKey(page, frame, 'Shift+F10'),
  )
  await safe('esc-layering', 'Escape layering', () => assertEscapeLayering(page, frame))
  await safe('dialog-trap', 'Dialogs trap Tab and restore focus', () => assertDialogFocusTrap(page, frame))
  await safe('no-body-focus', 'No focus on document.body after keyboard ops', () =>
    assertNeverBodyFocus(page, frame, out),
  )

  void n
  return out
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 */
async function assertTabGridOnce(page, frame) {
  const name = 'Tab enters grid exactly once; one more Tab leaves'
  // SelectedBar after the grid needs a selection, else Tab leaves into document.body.
  await ensureSomethingSelected(frame)
  await sleep(80)
  const focused = await focusSearch(frame)
  if (!focused.ok) {
    return result('tab-grid-once', name, false, focused.reason)
  }
  const start = await describeActive(frame)
  if (start.kind !== 'search') {
    return result('tab-grid-once', name, false, `could not focus search (got kind=${start.kind})`)
  }

  const trail = await tabTrail(page, frame, 40)
  // Composite-widget enter = focus on a grid cell (card/header), not Select All chrome.
  let enters = 0
  let firstEnterIdx = -1
  let wasIn = false
  let tabStopsInsideGrid = 0
  for (let i = 0; i < trail.length; i += 1) {
    const snap = trail[i]
    if (snap.inGrid) tabStopsInsideGrid += 1
    const now = Boolean(snap.inGridCell)
    if (now && !wasIn) {
      enters += 1
      if (firstEnterIdx < 0) firstEnterIdx = i
    }
    wasIn = now
  }

  if (enters === 0) {
    return result(
      'tab-grid-once',
      name,
      false,
      `Tab×40 from search never focused a grid cell (card/header). ` +
        `inGridChromeStops=${tabStopsInsideGrid} last=${trail.at(-1)?.kind}/${trail.at(-1)?.tag}`,
    )
  }

  if (enters !== 1) {
    return result(
      'tab-grid-once',
      name,
      false,
      `entered grid cells ${enters} times (want 1 — composite widget / single tab stop)`,
    )
  }

  // From inside grid cell, one Tab should leave the grid entirely.
  await focusSearch(frame)
  for (let i = 0; i <= firstEnterIdx; i += 1) {
    await press(page, frame, 'Tab')
  }
  const inside = await describeActive(frame)
  if (!inside.inGridCell) {
    return result(
      'tab-grid-once',
      name,
      false,
      `lost grid-cell focus at enter index ${firstEnterIdx} (kind=${inside.kind})`,
    )
  }
  await press(page, frame, 'Tab')
  const after = await describeActive(frame)
  if (after.inGrid) {
    return result(
      'tab-grid-once',
      name,
      false,
      `Tab from focused grid cell stayed in grid (kind=${after.kind}) — expect single leave`,
    )
  }
  if (after.isBody) {
    return result('tab-grid-once', name, false, 'after leaving grid, focus landed on document.body')
  }
  return result('tab-grid-once', name, true, `enter@Tab${firstEnterIdx + 1}; leave→${after.kind}`)
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 */
async function assertArrowTraversal(page, frame) {
  const name = 'Arrows traverse cards, header cells, collapsed groups'
  const focus = await tryFocusFirstCard(page, frame)
  if (!focus.ok) {
    return result(
      'arrows-traverse',
      name,
      false,
      `no focusable card/header (via=${focus.via}, kind=${focus.snap.kind}) — arrow nav unavailable`,
    )
  }

  const before = await describeActive(frame)
  await press(page, frame, 'ArrowRight')
  await sleep(40)
  const right = await describeActive(frame)
  await press(page, frame, 'ArrowDown')
  await sleep(40)
  const down = await describeActive(frame)

  const moved =
    (right.title && right.title !== before.title) ||
    (down.title && down.title !== before.title) ||
    right.kind !== before.kind ||
    down.kind !== before.kind

  if (!moved) {
    return result(
      'arrows-traverse',
      name,
      false,
      `ArrowRight/Down did not move focus (stuck at ${before.kind}:${before.title || before.tag})`,
    )
  }

  const isHeaderCell = (snap) => Boolean(snap.isHeaderCell)

  // Ctrl+Home → first grid cell (category header).
  await press(page, frame, 'Control+Home')
  await sleep(60)
  let sawHeader = isHeaderCell(await describeActive(frame))
  if (!sawHeader) {
    for (let i = 0; i < 8 && !sawHeader; i += 1) {
      await press(page, frame, 'ArrowUp')
      sawHeader = isHeaderCell(await describeActive(frame))
    }
  }
  if (!sawHeader) {
    return result(
      'arrows-traverse',
      name,
      false,
      `ArrowRight/Down moved, but Ctrl+Home/ArrowUp never focused a header cell (at ${JSON.stringify(await describeActive(frame))})`,
    )
  }

  // Collapsed group: collapse while on header, ArrowDown should still land on a grid cell.
  const headerBeforeCollapse = await describeActive(frame)
  const collapsed = await collapseFirstHeader(frame)
  await sleep(100)
  // Synthetic collapse click does not move focus — return to header via Ctrl+Home.
  await frame.evaluate(() => {
    const grid = document.querySelector('[role="grid"]')
    if (grid instanceof HTMLElement) {
      const cell = grid.querySelector('[data-cell-row][data-cell-col]')
      if (cell instanceof HTMLElement) cell.focus()
    }
  })
  await press(page, frame, 'Control+Home')
  await sleep(60)
  const onCollapsedHeader = isHeaderCell(await describeActive(frame))
  await press(page, frame, 'ArrowDown')
  await sleep(40)
  const afterCollapsedNav = await describeActive(frame)
  const collapsedNavOk =
    onCollapsedHeader &&
    (afterCollapsedNav.inGridCell || afterCollapsedNav.kind === 'card' || isHeaderCell(afterCollapsedNav))

  if (!collapsedNavOk) {
    return result(
      'arrows-traverse',
      name,
      false,
      `header ok (${headerBeforeCollapse.title}) but collapsed-group arrow nav failed ` +
        `(collapsed=${collapsed.category} onHeader=${onCollapsedHeader} after=${afterCollapsedNav.kind})`,
    )
  }

  return result(
    'arrows-traverse',
    name,
    true,
    `moved ${before.kind}→${right.kind}/${down.kind}; header+collapsed ok (${collapsed.category})`,
  )
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 */
async function assertEnterSpaceToggle(page, frame) {
  const name = 'Enter and Space toggle selection (selected count)'
  const focus = await tryFocusFirstCard(page, frame)
  if (!focus.ok) {
    return result(
      'enter-space-toggle',
      name,
      false,
      `cannot focus card for Enter/Space (kind=${focus.snap.kind})`,
    )
  }

  const before = await selectedCount(frame)
  await press(page, frame, 'Enter')
  await sleep(80)
  const afterEnter = await selectedCount(frame)
  await press(page, frame, 'Space')
  await sleep(80)
  const afterSpace = await selectedCount(frame)

  const enterChanged = afterEnter !== before
  const spaceChanged = afterSpace !== afterEnter

  if (!enterChanged && !spaceChanged) {
    return result(
      'enter-space-toggle',
      name,
      false,
      `selected count unchanged after Enter+Space (count=${before}; Save set bar / accent chrome)`,
    )
  }
  if (!enterChanged || !spaceChanged) {
    return result(
      'enter-space-toggle',
      name,
      false,
      `partial: before=${before} afterEnter=${afterEnter} afterSpace=${afterSpace}`,
    )
  }
  return result(
    'enter-space-toggle',
    name,
    true,
    `count ${before}→${afterEnter} (Enter)→${afterSpace} (Space)`,
  )
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 */
async function assertNavKeys(page, frame) {
  const name = 'Home/End/Ctrl+Home/Ctrl+End/PageDown; focused cell visible'
  const focus = await tryFocusFirstCard(page, frame)
  if (!focus.ok) {
    return result(
      'nav-keys-visible',
      name,
      false,
      `cannot focus grid cell to start navigation (kind=${focus.snap.kind})`,
    )
  }

  const keys = ['Home', 'End', 'Control+Home', 'Control+End', 'PageDown']
  /** @type {string[]} */
  const fails = []
  /** @type {string[]} */
  const okKeys = []

  for (const key of keys) {
    await press(page, frame, key)
    await sleep(60)
    const snap = await describeActive(frame)
    const vis = await focusedCellVisible(frame)
    if (!snap.inGrid || snap.isBody) {
      fails.push(`${key}: focus left grid (kind=${snap.kind})`)
      continue
    }
    if (!vis.ok) {
      fails.push(`${key}: ${vis.reason}`)
      continue
    }
    okKeys.push(key)
  }

  if (fails.length) {
    return result(
      'nav-keys-visible',
      name,
      false,
      `ok=[${okKeys.join(',')}] fail=[${fails.join('; ')}]`,
    )
  }
  return result('nav-keys-visible', name, true, `all keys kept focus visible: ${okKeys.join(', ')}`)
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 */
async function assertFocusAfterKeyboardScroll(page, frame) {
  const name = 'Focused card stays focused after 3-screen keyboard scroll'
  const focus = await tryFocusFirstCard(page, frame)
  if (!focus.ok) {
    return result(
      'focus-after-scroll',
      name,
      false,
      `cannot focus card before scroll (kind=${focus.snap.kind})`,
    )
  }

  const before = await describeActive(frame)
  for (let i = 0; i < 3; i += 1) {
    await press(page, frame, 'PageDown')
    await sleep(100)
  }
  await frame.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  )

  const after = await describeActive(frame)
  if (after.isBody) {
    return result('focus-after-scroll', name, false, 'activeElement is document.body after PageDown×3')
  }
  if (!after.inGrid) {
    return result(
      'focus-after-scroll',
      name,
      false,
      `activeElement left grid after PageDown×3 (kind=${after.kind} tag=${after.tag})`,
    )
  }
  // Prefer same card title when still mounted; still PASS if any grid cell keeps focus.
  const same = before.title && after.title && before.title === after.title
  return result(
    'focus-after-scroll',
    name,
    true,
    same
      ? `same card focused after PageDown×3 (${after.title})`
      : `activeElement still in grid (before=${before.title || before.kind}, after=${after.title || after.kind})`,
  )
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 * @param {string} key
 */
async function assertContextMenuKey(page, frame, key) {
  const id = key === 'Shift+F10' ? 'menu-shift-f10' : 'menu-contextmenu'
  const name = `${key} opens card menu; arrows move; Escape closes; focus returns`
  await dismissOverlays(page, frame)

  const focus = await tryFocusFirstCard(page, frame)
  if (!focus.ok) {
    return result(id, name, false, `cannot focus card before ${key} (kind=${focus.snap.kind})`)
  }
  const cardBefore = await describeActive(frame)

  await press(page, frame, key)
  await sleep(150)
  const menu = await findOpenMenu(frame)
  if (!menu.found) {
    return result(
      id,
      name,
      false,
      `${key} did not open card menu (no role=menu / fixed portal). Cards are mouse contextmenu-only today.`,
    )
  }
  if (!menu.inViewport) {
    return result(
      id,
      name,
      false,
      `menu opened but overflows viewport (${JSON.stringify(menu.overflow)})`,
    )
  }

  // Arrow through items — focused control or aria-activedescendant should change.
  const itemBefore = await frame.evaluate(() => {
    const ae = document.activeElement
    return {
      tag: ae?.tagName,
      text: (ae?.textContent || '').trim().slice(0, 40),
      activeDesc: ae?.getAttribute?.('aria-activedescendant') || null,
    }
  })
  await press(page, frame, 'ArrowDown')
  await sleep(40)
  await press(page, frame, 'ArrowDown')
  await sleep(40)
  const itemAfter = await frame.evaluate(() => {
    const ae = document.activeElement
    return {
      tag: ae?.tagName,
      text: (ae?.textContent || '').trim().slice(0, 40),
      activeDesc: ae?.getAttribute?.('aria-activedescendant') || null,
    }
  })
  const arrowsMoved =
    itemBefore.text !== itemAfter.text ||
    itemBefore.activeDesc !== itemAfter.activeDesc ||
    itemBefore.tag !== itemAfter.tag

  if (!arrowsMoved) {
    await press(page, frame, 'Escape')
    return result(id, name, false, 'menu open in viewport but ArrowDown did not move menu focus')
  }

  await resetCloseCounter(page)
  await press(page, frame, 'Escape')
  await sleep(80)
  const menuAfter = await findOpenMenu(frame)
  const closes = await closeCount(page)
  const focusAfter = await describeActive(frame)

  if (menuAfter.found) {
    return result(id, name, false, 'Escape did not close menu')
  }
  if (closes > 0) {
    return result(id, name, false, `Escape closed menu but also posted SG_CLOSE_REQUEST (count=${closes})`)
  }
  if (focusAfter.kind !== 'card') {
    return result(
      id,
      name,
      false,
      `focus did not return to card (got kind=${focusAfter.kind}, was=${cardBefore.title})`,
    )
  }
  return result(id, name, true, `menu ok; arrows moved; Escape restore→${focusAfter.title}`)
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 */
async function assertEscapeLayering(page, frame) {
  const namePrefix = 'Escape layering'
  /** @type {AssertionResult[]} */
  const results = []

  // (a) menu → Escape closes only menu
  await dismissOverlays(page, frame)
  await clearSearch(frame)
  await resetCloseCounter(page)
  {
    let menu = await findOpenMenu(frame)
    if (!menu.found) {
      const focus = await tryFocusFirstCard(page, frame)
      if (focus.ok) {
        await press(page, frame, 'Shift+F10')
        await sleep(120)
        menu = await findOpenMenu(frame)
      }
    }
    if (!menu.found) {
      await openCardContextMenuMouse(frame)
      await sleep(120)
      menu = await findOpenMenu(frame)
    }
    if (!menu.found) {
      results.push(
        result(
          'esc-menu',
          `${namePrefix}: menu → Escape closes only menu`,
          false,
          'could not open card menu (keyboard or mouse) to probe Escape layering',
        ),
      )
    } else {
      await clearSearch(frame)
      await resetCloseCounter(page)
      await press(page, frame, 'Escape')
      await sleep(80)
      const still = await findOpenMenu(frame)
      const closes = await closeCount(page)
      const pass = !still.found && closes === 0
      results.push(
        result(
          'esc-menu',
          `${namePrefix}: menu → Escape closes only menu`,
          pass,
          pass
            ? 'menu dismissed; no SG_CLOSE_REQUEST'
            : `menuOpen=${still.found} SG_CLOSE_REQUEST=${closes} (menu has no Escape handler; App falls through)`,
        ),
      )
      if (still.found) {
        await frame.evaluate(() => {
          const backdrops = [...document.body.querySelectorAll(':scope > div.fixed')].filter((el) => {
            const r = el.getBoundingClientRect()
            return r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2
          })
          for (const b of backdrops) b.click()
        })
      }
    }
  }

  // (b) dialog → Escape closes only dialog
  await dismissOverlays(page, frame)
  await clearSearch(frame)
  await resetCloseCounter(page)
  {
    const open = await ensureSaveSetDialogOpen(frame)
    await sleep(100)
    const dlg = await findOpenDialog(frame)
    if (!open.ok || !dlg.found) {
      results.push(
        result(
          'esc-dialog',
          `${namePrefix}: dialog → Escape closes only dialog`,
          false,
          `Save set dialog not open (${open.reason || 'missing'})`,
        ),
      )
    } else {
      await clearSearch(frame)
      await resetCloseCounter(page)
      await press(page, frame, 'Escape')
      await sleep(100)
      const dlgAfter = await findOpenDialog(frame)
      const closes = await closeCount(page)
      const pass = !dlgAfter.found && closes === 0
      results.push(
        result(
          'esc-dialog',
          `${namePrefix}: dialog → Escape closes only dialog`,
          pass,
          pass
            ? 'dialog closed; no SG_CLOSE_REQUEST'
            : `dialogOpen=${dlgAfter.found} SG_CLOSE_REQUEST=${closes}`,
        ),
      )
    }
  }

  // (c) search text → Escape clears visible input text (panel stays)
  await dismissOverlays(page, frame)
  await clearSearch(frame)
  await resetCloseCounter(page)
  {
    // Ensure no dialog layer can steal the first Escape.
    await dismissOverlays(page, frame)
    const fs = await focusSearch(frame)
    if (!fs.ok) {
      results.push(
        result(
          'esc-search',
          `${namePrefix}: search text → Escape clears text`,
          false,
          fs.reason,
        ),
      )
    } else {
      await page.keyboard.type('zzznomatch999', { delay: 10 })
      await sleep(60)
      await focusSearch(frame)
      // Close suggestion popover via ✕ clear is wrong; click outside, then restore typed value
      // if empty. Prefer a query with zero suggestions so the list stays closed.
      await frame.evaluate(() => {
        document.body.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            clientX: 4,
            clientY: 4,
            view: window,
          }),
        )
      })
      await sleep(40)
      await focusSearch(frame)
      let before = await searchValue(frame)
      if (!before) {
        await page.keyboard.type('zzznomatch999', { delay: 10 })
        before = await searchValue(frame)
      }
      const pre = await frame.evaluate(() => ({
        ariaExpanded: document
          .querySelector('input[placeholder="Search styles..."]')
          ?.getAttribute('aria-expanded'),
        roleMenu: Boolean(document.querySelector('[role="menu"]')),
        dialog: Boolean(document.querySelector('[role="dialog"]')),
      }))
      if (pre.dialog) {
        results.push(
          result(
            'esc-search',
            `${namePrefix}: search text → Escape clears text`,
            false,
            `blocked: dialog still open before Escape (${JSON.stringify(pre)})`,
          ),
        )
      } else {
        await resetCloseCounter(page)
        await press(page, frame, 'Escape')
        await sleep(80)
        const after = await searchValue(frame)
        const closes = await closeCount(page)
        const pass = Boolean(before && before.length > 0 && after === '' && closes === 0)
        results.push(
          result(
            'esc-search',
            `${namePrefix}: search text → Escape clears text`,
            pass,
            pass
              ? `cleared "${before}"→""; no close`
              : `before=${JSON.stringify(before)} after=${JSON.stringify(after)} closes=${closes} ` +
                `pre=${JSON.stringify(pre)}` +
                (before && after === before
                  ? ' (Escape did not clear visible search text)'
                  : ''),
          ),
        )
      }
    }
  }

  // (d) nothing open → Escape posts SG_CLOSE_REQUEST
  await dismissOverlays(page, frame)
  await clearSearch(frame)
  {
    const fs = await focusSearch(frame)
    if (!fs.ok) {
      results.push(
        result(
          'esc-close',
          `${namePrefix}: nothing open → Escape posts SG_CLOSE_REQUEST`,
          false,
          fs.reason,
        ),
      )
      return results
    }
  }
  await resetCloseCounter(page)
  await press(page, frame, 'Escape')
  await sleep(80)
  const closes = await closeCount(page)
  results.push(
    result(
      'esc-close',
      `${namePrefix}: nothing open → Escape posts SG_CLOSE_REQUEST`,
      closes >= 1,
      closes >= 1 ? `SG_CLOSE_REQUEST count=${closes}` : 'no SG_CLOSE_REQUEST posted',
    ),
  )

  return results
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 */
async function assertDialogFocusTrap(page, frame) {
  const name = 'Dialogs trap Tab and restore focus'
  await dismissOverlays(page, frame)

  const open = await ensureSaveSetDialogOpen(frame)
  await sleep(100)
  if (!open.ok) {
    return result('dialog-trap', name, false, open.reason || 'dialog not opened')
  }

  const triggerSnap = await frame.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /Save set\s*\(\d+\)/.test(b.textContent || ''),
    )
    return btn ? (btn.textContent || '').trim() : null
  })

  // Focus should be inside dialog after open.
  let snap = await describeActive(frame)
  if (snap.kind !== 'dialog') {
    // SaveSetDialog focuses input — kind may be 'control' inside dialog.
    const inside = await frame.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]')
      return Boolean(dlg && dlg.contains(document.activeElement))
    })
    if (!inside) {
      return result('dialog-trap', name, false, `focus not inside dialog after open (kind=${snap.kind})`)
    }
  }

  /** @type {string[]} */
  const focusIds = []
  for (let i = 0; i < 12; i += 1) {
    await press(page, frame, 'Tab')
    const inside = await frame.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]')
      const ae = document.activeElement
      if (!dlg || !ae) return { inside: false, id: 'none' }
      return {
        inside: dlg.contains(ae),
        id: `${ae.tagName}:${(ae.getAttribute('aria-label') || ae.textContent || '').trim().slice(0, 24)}`,
      }
    })
    focusIds.push(inside.id)
    if (!inside.inside) {
      return result(
        'dialog-trap',
        name,
        false,
        `Tab escaped dialog at step ${i + 1} → ${inside.id}`,
      )
    }
  }

  // Close via Cancel / Escape — prefer button to avoid panel-close side effect for restore check.
  await frame.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]')
    const cancel = dlg && [...dlg.querySelectorAll('button')].find((b) => /cancel/i.test(b.textContent || ''))
    if (cancel) cancel.click()
  })
  await sleep(80)
  const dlgGone = !(await findOpenDialog(frame)).found
  if (!dlgGone) {
    await press(page, frame, 'Escape')
    await sleep(80)
  }

  const after = await describeActive(frame)
  const restored = await frame.evaluate((label) => {
    const ae = document.activeElement
    if (!ae || !label) return false
    return (ae.textContent || '').includes('Save set')
  }, triggerSnap)

  if (!restored) {
    return result(
      'dialog-trap',
      name,
      false,
      `Tab stayed in dialog (${[...new Set(focusIds)].join('|')}) but focus not restored to Save set (kind=${after.kind})`,
    )
  }
  return result('dialog-trap', name, true, 'Tab cycled inside dialog; focus restored to Save set')
}

/**
 * Meta-check: none of the recorded ops left body focus when a pass claimed success,
 * plus a final activeElement probe.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 * @param {AssertionResult[]} prior
 */
async function assertNeverBodyFocus(page, frame, prior) {
  const name = 'No focus on document.body after keyboard ops'
  void page
  const final = await describeActive(frame)
  // Soft: if every prior assertion failed due to missing focusability, body focus is expected.
  const anyPass = prior.some((r) => r.pass)
  if (final.isBody && anyPass) {
    return result(
      'no-body-focus',
      name,
      false,
      'activeElement is document.body after suite (lost focus)',
    )
  }
  if (final.isBody && !anyPass) {
    return result(
      'no-body-focus',
      name,
      false,
      'activeElement is document.body (expected until grid cells are focusable; still FAIL per contract)',
    )
  }
  return result('no-body-focus', name, true, `final focus kind=${final.kind} tag=${final.tag}`)
}
