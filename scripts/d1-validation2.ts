import { chromium } from 'playwright';
async function runValidation() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const email = `test.agent.34510@example.com`;
    await page.goto('https://leadpilot.live/login');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 30000 });
    
    await page.goto('https://leadpilot.live/jobs/applications/cmur00hez01aelm0va0miwbzi');
    await page.waitForTimeout(2000);
    const html = await page.content();
    const index = html.indexOf("inspection");
    console.log("Inspection line context:", html.substring(index - 100, index + 100));
  } finally {
    await browser.close();
  }
}
runValidation();
