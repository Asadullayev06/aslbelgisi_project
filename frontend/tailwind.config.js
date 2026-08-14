/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:        "hsl(var(--bg))",
        surface:   "hsl(var(--surface))",
        surface2:  "hsl(var(--surface-2))",
        border:    "hsl(var(--border))",
        text:      "hsl(var(--text))",
        muted:     "hsl(var(--muted))",
        accent:    "hsl(var(--accent))",
        accent2:   "hsl(var(--accent-2))",
        success:   "hsl(var(--success))",
        warning:   "hsl(var(--warning))",
        danger:    "hsl(var(--danger))",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px hsl(var(--accent) / 0.35), 0 8px 40px -8px hsl(var(--accent) / 0.35)",
      },
      keyframes: {
        pulseSlot: {
          "0%,100%": { boxShadow: "0 0 0 0 hsl(var(--accent) / 0.6)" },
          "50%":     { boxShadow: "0 0 0 4px hsl(var(--accent) / 0)" },
        },
      },
      animation: {
        pulseSlot: "pulseSlot 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
