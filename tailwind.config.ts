import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#08090c",
          900: "#0c0e13",
          850: "#11141b",
          800: "#161a23",
          700: "#1d2230",
          600: "#272d3d",
          500: "#3a4256",
          400: "#5b6479",
        },
        edge: {
          positive: "#16d394",
          neutral: "#7a839a",
          negative: "#ff5b6e",
        },
        accent: {
          DEFAULT: "#4f8cff",
          soft: "#1f2c4a",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 32px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
