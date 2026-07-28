import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#f6f7f9",
        surface: "#ffffff",
        border: "#d9dde3",
        text: "#1f2933",
        muted: "#57606a",
        accent: "#1d4ed8",
        danger: "#b91c1c",
      },
      borderRadius: {
        card: "6px",
      },
      maxWidth: {
        content: "1200px",
      },
    },
  },
  plugins: [],
};

export default config;
