/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,ts}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        ink: "rgb(var(--bg) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        panel2: "rgb(var(--line) / <alpha-value>)",
        brand: "rgb(var(--brand) / <alpha-value>)",
        brandd: "rgb(var(--brand-h) / <alpha-value>)",
        chalk: "rgb(var(--text) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        // 状态色：随主题切换（亮色 600 系 / 暗色 400 系），别再写死 red-500 / amber-500
        ok: "rgb(var(--ok) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        err: "rgb(var(--err) / <alpha-value>)",
      },
      boxShadow: {
        glow:
          "0 0 0 1px rgb(var(--brand) / 0.25), 0 8px 30px -8px rgb(var(--brand) / 0.35)",
      },
    },
  },
  plugins: [],
};
