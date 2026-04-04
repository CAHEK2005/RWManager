const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const screenshotsDir = 'C:/Users/admin/Documents/GitHub/RWManager/client/pw_screenshots';
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  const mockNodes = [
    { id: 'node-1', name: 'Server 1', ip: '192.168.1.1', sshPort: 22, sshUser: 'root', authType: 'password', password: 'pass', categoryIds: ['cat-1'] },
  ];
  const mockScripts = [
    { id: 'script-1', name: 'Update System', content: 'apt update', description: 'Update' },
  ];
  const mockSecrets = [
    { id: 'sec-1', name: 'My Password', type: 'password', description: '', createdAt: '2024-01-01' },
  ];
  const mockCategories = [
    { id: 'cat-1', name: 'Сервер', color: '#1976d2' },
  ];

  await context.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes('/auth/login') && method === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'mock-token' }) });
    if (url.includes('/secrets') && !url.includes('/value') && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockSecrets) });
    if (url.includes('/scripts/ssh-nodes') && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockNodes) });
    if (url.includes('/scripts/scripts') && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockScripts) });
    if (url.includes('/settings') && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ node_categories: JSON.stringify(mockCategories) }) });
    if (url.includes('/settings') && method === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    return route.continue();
  });

  const page = await context.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));

  try {
    await page.goto('http://localhost:5174', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(() => localStorage.setItem('token', 'mock-token'));
    await page.goto('http://localhost:5174/scripts', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(800);

    // Test 1: Click delete node button -> should show ConfirmDialog
    console.log('\n=== Test 1: Delete node confirmation ===');
    const deleteNodeBtn = page.locator('button[title="Удалить"], [aria-label="Удалить"]').first();
    // Find delete icon button in table
    const deleteIcons = page.locator('table button:has(.MuiSvgIcon-root[data-testid="DeleteIcon"]), table .MuiIconButton-colorError');
    const deleteIconCount = await deleteIcons.count();
    console.log(`Delete buttons in table: ${deleteIconCount}`);

    if (deleteIconCount > 0) {
      await deleteIcons.first().click();
      await page.waitForTimeout(400);
      const dialog = page.locator('[role="dialog"]');
      const dialogVisible = await dialog.isVisible().catch(() => false);
      console.log(`Confirm dialog appeared: ${dialogVisible ? 'YES' : 'NO'}`);
      if (dialogVisible) {
        const dialogText = await dialog.textContent().catch(() => '');
        console.log(`Dialog text: "${dialogText.slice(0, 100)}"`);
        await page.screenshot({ path: `${screenshotsDir}/confirm_01_delete_node.png` });
        // Click Cancel
        const cancelBtn = dialog.locator('button:has-text("Отмена")');
        await cancelBtn.click();
        await page.waitForTimeout(300);
        console.log('Clicked Cancel, dialog should close');
      }
    }

    // Test 2: Open add node dialog, type text, click backdrop -> should warn
    console.log('\n=== Test 2: Close confirmation when form has data ===');
    const addNodeBtn = page.locator('button:has-text("Добавить")').first();
    await addNodeBtn.click();
    await page.waitForTimeout(400);

    // Type in name field
    const nameField = page.locator('[role="dialog"] input[name], [role="dialog"] input').first();
    await nameField.fill('Test Node');
    await page.waitForTimeout(200);

    // Click backdrop (outside dialog)
    await page.mouse.click(50, 450); // click outside the dialog
    await page.waitForTimeout(400);

    const closeConfirmDialog = page.locator('[role="dialog"]');
    const closeConfirmCount = await closeConfirmDialog.count();
    const closeDialogVisible = closeConfirmCount > 0 && await closeConfirmDialog.first().isVisible().catch(() => false);
    console.log(`Close confirm dialog appeared: ${closeDialogVisible ? 'YES' : 'NO'}`);
    await page.screenshot({ path: `${screenshotsDir}/confirm_02_close_warn.png` });

    if (closeDialogVisible) {
      const closeDialogText = await closeConfirmDialog.first().textContent().catch(() => '');
      console.log(`Close dialog text: "${closeDialogText.slice(0, 100)}"`);
      // Click cancel (don't close)
      const cancelBtn = closeConfirmDialog.first().locator('button:has-text("Отмена")');
      await cancelBtn.click();
      await page.waitForTimeout(300);
    }

    // Test 3: Go to Scripts tab and test delete script
    console.log('\n=== Test 3: Delete script confirmation ===');
    const tabs = page.locator('.MuiTab-root');
    if (await tabs.count() >= 2) {
      await tabs.nth(1).click();
      await page.waitForTimeout(400);
    }
    const delScriptBtn = page.locator('button.MuiButton-colorError, button:has-text("Удалить")').first();
    const delScriptCount = await delScriptBtn.count();
    console.log(`Delete script button found: ${delScriptCount > 0 ? 'YES' : 'NO'}`);
    if (delScriptCount > 0) {
      await delScriptBtn.click();
      await page.waitForTimeout(400);
      const delDialog = page.locator('[role="dialog"]');
      const delDialogVisible = await delDialog.isVisible().catch(() => false);
      console.log(`Delete script confirm dialog: ${delDialogVisible ? 'YES' : 'NO'}`);
      if (delDialogVisible) {
        const txt = await delDialog.textContent().catch(() => '');
        console.log(`Dialog text: "${txt.slice(0, 100)}"`);
        await page.screenshot({ path: `${screenshotsDir}/confirm_03_delete_script.png` });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      }
    }

    const significantErrors = errors.filter(e => !e.includes('404') && !e.includes('401'));
    console.log('\n=== SUMMARY ===');
    console.log('Significant console errors:', significantErrors.length === 0 ? 'None' : significantErrors.join('\n'));

  } catch (err) {
    console.error('PLAYWRIGHT ERROR:', err.message);
    await page.screenshot({ path: `${screenshotsDir}/confirm_error.png` }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
