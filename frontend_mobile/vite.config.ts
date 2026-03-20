import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import reactNativeWeb from 'vite-plugin-react-native-web';

export default defineConfig({
  plugins: [reactNativeWeb(), react()],
  resolve: {
    alias: {
      'react-native': 'react-native-web',
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    host:true, 
    allowedHosts:true,
  },
});
