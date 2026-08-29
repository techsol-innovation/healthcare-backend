const cron = require('node-cron');
const https = require('https');
const http = require('http');

/**
 * Keep-Alive ping job
 * Pings the server's public URL every 10 minutes to prevent Render from going to sleep.
 */
function startKeepAliveJob() {
  const serverUrl = process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL;
  
  if (!serverUrl) {
    console.log('ℹ️ Keep-Alive: No RENDER_EXTERNAL_URL or SERVER_URL provided. Skipping internal keep-alive cron.');
    return;
  }

  console.log(`⏱️ Keep-Alive job scheduled for: ${serverUrl}/health (every 10 minutes)`);

  cron.schedule('*/10 * * * *', () => {
    const healthUrl = `${serverUrl.replace(/\/$/, '')}/health`;
    const client = healthUrl.startsWith('https') ? https : http;

    client.get(healthUrl, (res) => {
      console.log(`[Keep-Alive] Pinged ${healthUrl} - Status: ${res.statusCode}`);
    }).on('error', (err) => {
      console.warn(`[Keep-Alive] Ping failed:`, err.message);
    });
  });
}

module.exports = { startKeepAliveJob };
