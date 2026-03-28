module.exports = {
  content: ["./index.html", "./src/**/*.{ts,js}"],
  theme: {
    extend: {
      colors: {
        chrome: {
          950: "rgb(var(--theme-chrome-950) / <alpha-value>)",
          900: "rgb(var(--theme-chrome-900) / <alpha-value>)",
          850: "rgb(var(--theme-chrome-850) / <alpha-value>)",
          800: "rgb(var(--theme-chrome-800) / <alpha-value>)",
          700: "rgb(var(--theme-chrome-700) / <alpha-value>)",
          600: "rgb(var(--theme-chrome-600) / <alpha-value>)"
        },
        accent: {
          500: "rgb(var(--theme-accent-500) / <alpha-value>)",
          400: "rgb(var(--theme-accent-400) / <alpha-value>)",
          300: "rgb(var(--theme-accent-300) / <alpha-value>)",
          200: "rgb(var(--theme-accent-200) / <alpha-value>)"
        },
        slate: {
          100: "rgb(var(--theme-slate-100) / <alpha-value>)",
          200: "rgb(var(--theme-slate-200) / <alpha-value>)",
          300: "rgb(var(--theme-slate-300) / <alpha-value>)",
          400: "rgb(var(--theme-slate-400) / <alpha-value>)",
          500: "rgb(var(--theme-slate-500) / <alpha-value>)",
          600: "rgb(var(--theme-slate-600) / <alpha-value>)"
        },
        red: {
          300: "rgb(var(--theme-red-300) / <alpha-value>)"
        },
        sky: {
          950: "rgb(var(--theme-sky-950) / <alpha-value>)"
        },
        emerald: {
          950: "rgb(var(--theme-emerald-950) / <alpha-value>)"
        },
        rose: {
          950: "rgb(var(--theme-rose-950) / <alpha-value>)"
        },
        amber: {
          200: "rgb(var(--theme-amber-200) / <alpha-value>)",
          900: "rgb(var(--theme-amber-900) / <alpha-value>)",
          950: "rgb(var(--theme-amber-950) / <alpha-value>)"
        }
      },
      boxShadow: {
        insetline: "inset 0 1px 0 rgb(var(--theme-inset-line) / 0.75)"
      },
      fontFamily: {
        mono: ["SFMono-Regular", "ui-monospace", "monospace"]
      }
    }
  },
  plugins: []
};
