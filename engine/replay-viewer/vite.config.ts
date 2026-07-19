import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Autonome mais importe les types/modules partagés depuis engine/ (hors racine du projet Vite) :
// il faut donc autoriser le serveur de dev à servir des fichiers en dehors de engine/replay-viewer/.
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: ['..'],
    },
  },
});
