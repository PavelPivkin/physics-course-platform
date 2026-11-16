// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://pavelpivkin.github.io",
  base: "/physics-course-platform",
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
