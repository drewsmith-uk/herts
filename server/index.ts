import { createApp } from './app.js';
import { configuration } from './config.js';
process.umask(0o077);
try {
  const config = configuration();
  const { app } = await createApp(config);
  await app.listen({ host: '127.0.0.1', port: config.port });
  console.log('Herts listening on loopback.');
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Herts could not start.');
  process.exit(1);
}
