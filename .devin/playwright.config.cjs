const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '../test/live-health/e2e',
  fullyParallel: true,
  use: { baseURL: 'http://localhost:3100', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: 'node server.js',
    cwd: require('node:path').resolve(__dirname, '..'),
    url: 'http://localhost:3100/live-health/api/session',
    reuseExistingServer: false,
    env: {
      PORT: '3100', APP_ORIGIN: 'http://localhost:3100', HOST: '127.0.0.1', NODE_ENV: 'test',
      WHOOP_CLIENT_ID: '', WHOOP_CLIENT_SECRET: '', ELEVENLABS_API_KEY: '', GROQ_API_KEY: '', OPENROUTER_API_KEY: '',
      TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', OUTBOUND_CALL_TO: '', OUTBOUND_WHATSAPP_TO: '',
      RETELL_CALLS_ENABLED: 'false', RETELL_API_KEY: '', RETELL_WEBHOOK_KEY: '', RETELL_AGENT_ID: '', RETELL_FROM_NUMBER: '', RETELL_ALLOWED_NUMBERS: '',
    },
  },
});
