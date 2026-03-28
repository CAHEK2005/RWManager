import { chromium } from 'C:/Users/admin/Documents/GitHub/3dp-manager-remna/playwright-tmp/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

await page.goto('http://localhost:5175');
await page.waitForTimeout(2000);

const inputs = await page.locator('input').all();
for (const inp of inputs) {
  const type = await inp.getAttribute('type');
  const placeholder = await inp.getAttribute('placeholder');
  console.log('Input:', { type, placeholder });
}

// Fill login form
const loginInputs = await page.locator('input').all();
if (loginInputs.length >= 2) {
  await loginInputs[0].fill('admin');
  await loginInputs[1].fill('admin');
  await page.locator('button').first().click();
  await page.waitForTimeout(3000);
}

console.log('URL after login:', page.url());
await page.screenshot({ path: 'C:/Users/admin/Documents/GitHub/3dp-manager-remna/pw-check-2.png' });

if (page.url().includes('/login')) {
  console.log('Still on login page - check credentials');
} else {
  await page.screenshot({ path: 'C:/Users/admin/Documents/GitHub/3dp-manager-remna/pw-check-main.png' });
  
  // Check menu items
  const menuText = await page.locator('.MuiListItemText-primary').allTextContents();
  console.log('Menu items:', menuText);
}

await browser.close();
console.log('Errors:', JSON.stringify(errors));
