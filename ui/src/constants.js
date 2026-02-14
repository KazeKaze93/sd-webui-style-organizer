export const CATEGORY_COLORS = {
  FAVORITES: "#eab308",
  BASE: "#6366f1",
  STYLE: "#3b82f6",
  SCENE: "#22c55e",
  THEME: "#8b5cf6",
  POSE: "#14b8a6",
  LIGHTING: "#f59e0b",
  COLOR: "#ec4899",
  CAMERA: "#f97316",
  OTHER: "#6b7280",
};

export const FAVORITES_STORAGE_KEY = "sg_favorites";

export function getFavorites(tabName) {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data[tabName] ? new Set(data[tabName]) : new Set();
  } catch {
    return new Set();
  }
}

export function setFavorites(tabName, set) {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    data[tabName] = [...set];
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(data));
  } catch (_) {}
}

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
