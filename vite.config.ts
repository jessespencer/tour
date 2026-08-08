import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cloudflare Pages serves from root — no base path needed.
export default defineConfig({
  plugins: [react()],
});
