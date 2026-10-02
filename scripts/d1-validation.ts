import { chromium } from 'playwright';

async function runValidation() {
  console.log("Starting production validation on https://leadpilot.live");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const email = `test.agent.34510@example.com`; // reusing the account
    await page.goto('https://leadpilot.live/login');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 30000 });
    console.log(`Logged in successfully as ${email}`);

    // Wait for the application to be prepared by the worker (just in case)
    await page.goto('https://leadpilot.live/jobs/applications');
    await page.waitForTimeout(3000);
    
    const applicationLinks = await page.$$('a[href^="/jobs/applications/"]');
    let href = null;
    for (const link of applicationLinks) {
      const linkHref = await link.getAttribute('href');
      if (linkHref && linkHref !== "/jobs/applications/queue") {
        href = linkHref;
        break;
      }
    }
    
    if (!href) {
        console.error("No application found.");
        return;
    }
    console.log(`Navigating to application review: ${href}`);
    
    await page.goto(`https://leadpilot.live${href}`);
    await page.waitForTimeout(3000);
    
    console.log("Triggering browser automation...");
    const runAutomationButton = await page.$('button:has-text("Run Browser Automation")');
    if (runAutomationButton) {
        await runAutomationButton.click();
        await page.waitForTimeout(3000);
        console.log("Automation queued. Waiting for worker to process...");
    } else {
        console.error("Button not found! Ensure the deployment succeeded and condition is met.");
        return;
    }

    let finalStateFound = false;
    for (let i = 0; i < 30; i++) {
      await page.reload();
      await page.waitForTimeout(3000);
      const content = await page.content();
      
      if (content.includes('Application state READY_FOR_SUBMISSION') || 
          content.includes('Blocker CAPTCHA_REQUIRED') || 
          content.includes('Blocker CLOUDFLARE_CHALLENGE') ||
          content.includes('Blocker LOGIN_REQUIRED') ||
          content.includes('Blocker RATE_LIMITED') ||
          content.includes('Blocker UNKNOWN_REQUIRED_FIELD') ||
          content.includes('Blocker FORM_NOT_FOUND')) {
        console.log("Reached final state!");
        finalStateFound = true;
        const textContext = await page.locator('.font-display:has-text("Application") + p + p + p + p').innerText();
        console.log("Application info: ", textContext);
        break;
      }
      console.log("Still processing...");
      await page.waitForTimeout(7000);
    }
    
    if (finalStateFound) {
      console.log("Validation script completed successfully.");
    } else {
      console.log("Timeout waiting for final state.");
    }

  } catch (err) {
    console.error("Error during validation:", err);
  } finally {
    await browser.close();
  }
}

runValidation();
