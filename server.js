// Starts Recipe Box. Settings come from environment variables (see README).
import { createApp } from './lib/app.js';

const PORT = Number(process.env.PORT) || 3000;
const app = createApp();
app.listen(PORT, () => console.log(`Recipe Box running at http://localhost:${PORT}`));

// Anything that slips through: log it, email the owner (if alerts are set up), keep serving
process.on('unhandledRejection', e => app.alerts.report('Server (unhandled)', e));
process.on('uncaughtException', e => {
  app.alerts.report('Server crash', e).finally(() => process.exit(1)); // Fly restarts the app
});
