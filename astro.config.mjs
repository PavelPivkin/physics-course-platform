// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://pavelpivkin.github.io",
  base: "/physics-course-platform",
  vite: {
    plugins: [tailwindcss()],
  },
});
