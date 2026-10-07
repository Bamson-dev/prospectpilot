/* eslint-disable */
const https = require('https');

function check() {
  https.request('https://leadpilot.live/api/admin/outreach-sync', { method: 'POST' }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log(`Status: ${res.statusCode}, Data: ${data}`);
      if (res.statusCode === 200) {
        console.log("Trigger successful!");
        process.exit(0);
      } else {
        setTimeout(check, 10000); // Check again in 10s
      }
    });
  }).on('error', (e) => {
    console.error(e);
    setTimeout(check, 10000);
  }).end();
}

console.log("Waiting for deployment and triggering sync...");
check();
