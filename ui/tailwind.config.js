/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        border: "var(--border-color-primary, #374151)",
        background: "var(--background-fill-primary, #111827)",
        "background-secondary": "var(--background-fill-secondary, #1f2937)",
        accent: "var(--color-accent, #6366f1)",
        muted: "var(--body-text-color-subdued, #9ca3af)",
        foreground: "var(--body-text-color, #f3f4f6)",
      },
    },
  },
  plugins: [],
};
