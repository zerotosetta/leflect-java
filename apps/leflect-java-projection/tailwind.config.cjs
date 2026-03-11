module.exports = {
  content: ["./index.html", "./src/**/*.{ts,js}"],
  theme: {
    extend: {
      colors: {
        chrome: {
          950: "#050816",
          900: "#0a1020",
          850: "#11192d",
          800: "#17233c",
          700: "#24345a",
          600: "#34508d"
        },
        accent: {
          500: "#8ad6ff",
          400: "#7ee0a0",
          300: "#f5c46b",
          200: "#ff8b8b"
        }
      },
      boxShadow: {
        insetline: "inset 0 1px 0 rgba(255,255,255,0.04)"
      },
      fontFamily: {
        mono: ["SFMono-Regular", "ui-monospace", "monospace"]
      }
    }
  },
  plugins: []
};
