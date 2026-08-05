import type { Config } from "tailwindcss";
export default { content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"], darkMode: "class", theme: { extend: { colors: { brand: { 50: "#edf4ff", 500: "#1155cc", 700: "#073b9c", orange: "#ff7a00" } }, boxShadow: { glow: "0 20px 60px rgba(17,85,204,.22)" } } }, plugins: [] } satisfies Config;
