/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        industrial: {
          bg: "#05070a",
          surface: "#0c0e14",
          card: "#121620",
          border: "#1e2633",
          hover: "#1a2230",
          accent: "#10b981",
          accentHover: "#059669",
          muted: "#94a3b8",
          subtle: "#64748b",
          danger: "#ef4444",
          warning: "#f59e0b",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "Roboto",
          "'Helvetica Neue'",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "'JetBrains Mono'",
          "'Cascadia Code'",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
