const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const redis = new IORedis("redis://localhost:6379");
const q = new Queue('test', { connection: redis });
async function main() {
  try {
    await q.add('test', {}, { backoff: { type: 'job-retry', delay: 1000 }});
    console.log("Success");
  } catch (e) {
    console.error("Error:", e.message);
  }
}
main().then(() => process.exit(0));
