import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createApiApp } from './server/app.ts';

const PORT = Number(process.env.PORT ?? 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = createApiApp();

  // Vite Dev Middleware (Development) or Static Dist Serving (Production)
  const distDir = path.resolve(process.cwd(), 'dist');
  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Engagement Banking Copilot server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
