import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        cream: {
          50: "#fdfaf3",
          100: "#fbf6ec",
          200: "#f7ede0",
          300: "#f0e0cb",
        },
        ink: {
          950: "#1a1714",
          900: "#26221f",
          800: "#3a3531",
          700: "#534c46",
          600: "#776f68",
          500: "#9a9189",
          400: "#bcb3a9",
          300: "#dcd3c9",
          200: "#ece4d7",
          100: "#f5eee2",
        },
        edge: {
          positive: "#0d9488",
          neutral: "#9a8c7a",
          negative: "#e76f51",
        },
        accent: {
          DEFAULT: "#f59e0b",
          soft: "#fde68a",
        },
        coral: {
          400: "#ff8a73",
          500: "#ff7e6b",
          600: "#e76f51",
          700: "#c4543b",
        },
        gold: {
          300: "#fde68a",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
        },
        sea: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#065f46",
        },
        sky2: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "monospace"],
      },
      boxShadow: {
        glass: "0 1px 2px rgba(120, 90, 40, 0.04), 0 12px 32px -16px rgba(80, 60, 30, 0.18)",
        "glass-lg": "0 2px 4px rgba(120, 90, 40, 0.06), 0 28px 56px -22px rgba(80, 60, 30, 0.22)",
        "glow-amber": "0 0 0 1px rgba(251, 191, 36, 0.4), 0 6px 24px -8px rgba(251, 191, 36, 0.35)",
      },
      backdropBlur: {
        xs: "2px",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      backgroundImage: {
        "grid-soft":
          "radial-gradient(rgba(70, 60, 50, 0.08) 1.1px, transparent 1.1px)",
      },
    },
  },
  plugins: [],
};

export default config;
