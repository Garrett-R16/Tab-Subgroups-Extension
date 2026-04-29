import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';

test('extension loads successfully', async () => {
  const pathToExtension = path.resolve(__dirname, '../../');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
    ],
  });
  
  // Wait for the service worker to be ready
  const [worker] = context.serviceWorkers();
  expect(worker).toBeTruthy();
  
  await context.close();
});
