// Starts Recipe Box. Settings come from environment variables (see README).
import { createApp } from './lib/app.js';

const PORT = Number(process.env.PORT) || 3000;
createApp().listen(PORT, () => console.log(`Recipe Box running at http://localhost:${PORT}`));
