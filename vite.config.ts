import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
export default defineConfig({
  base: './',
  plugins: [preact()],
  server: { port: 5190 },
  preview: { port: 4190 },
});
