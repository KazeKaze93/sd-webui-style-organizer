/**
 * The selection tray (style info, selection header, chips) never takes more
 * than this fraction of the panel height; chips scroll inside it. The iframe
 * viewport is the panel, so the cap is expressed in `vh`.
 */
export const TRAY_MAX_HEIGHT_RATIO = 0.35

/** CSS max-height for the tray, derived from {@link TRAY_MAX_HEIGHT_RATIO}. */
export const TRAY_MAX_HEIGHT_CSS = `${TRAY_MAX_HEIGHT_RATIO * 100}vh`

/** The chips area keeps at least one chip row even when the style info is tall. */
export const TRAY_CHIPS_MIN_HEIGHT_PX = 40
