// @ts-check
import { defineConfig } from "astro/config";

import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: node({
    mode: "standalone",
  }),
  vite: {
    server: {
      allowedHosts: ["f44e723f-799e-4389-b790-497c0703014e-00-2qdf2j0ik84y2.picard.replit.dev", 'localhost']
    }
  }
});
