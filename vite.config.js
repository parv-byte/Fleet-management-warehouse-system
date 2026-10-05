import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 3000,
    open: false
  },
  plugins: [
    {
      name: 'serve-tiled-files',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && (req.url.startsWith('/map/') || req.url.endsWith('.tsx') || req.url.endsWith('.tmj'))) {
            const cleanUrl = req.url.split('?')[0];
            const filePath = path.join(process.cwd(), cleanUrl);
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              if (filePath.endsWith('.tsx') || filePath.endsWith('.tmx')) {
                res.setHeader('Content-Type', 'application/xml; charset=utf-8');
              } else if (filePath.endsWith('.tmj') || filePath.endsWith('.json')) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
              } else if (filePath.endsWith('.png')) {
                res.setHeader('Content-Type', 'image/png');
              }
              res.end(fs.readFileSync(filePath));
              return;
            }
          }
          next();
        });
      }
    }
  ]
});
