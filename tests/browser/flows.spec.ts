import { test, expect } from '@playwright/test';
import { fixturePassword } from '../helpers.js';

test('invite registration → tasks → equal random draw → pause/resume → completion → statistics', async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page).toHaveTitle('转个开始 · 今日任务转盘');
  await expect(page.getByRole('heading', { name: '今天，也从这里开始' })).toBeVisible();
  await page.getByLabel('用户名', { exact: true }).fill('browser_admin');
  await page.getByLabel('密码', { exact: true }).fill(fixturePassword);
  await page.getByRole('button', { name: '进入我的今天' }).click();
  await expect(page.getByRole('heading', { name: '今天，从哪件事开始？' })).toBeVisible();
  const manage = page.getByRole('button', { name: '管理空间' });
  if (testInfo.project.name === 'mobile') await page.getByLabel('账号菜单').click();
  await manage.click();
  await page.getByRole('button', { name: '生成邀请码', exact: true }).click();
  await page.getByRole('button', { name: '生成并查看' }).click();
  await expect(page.locator('.invite-codes')).toBeVisible();
  const invite = (await page.locator('.invite-codes').innerText()).trim();
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page
    .getByRole('button', { name: /^编辑邀请码/ })
    .first()
    .click();
  await page.getByLabel('每码可用次数').fill('2');
  await page.getByRole('dialog').getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const context = await browser.newContext({
    viewport:
      testInfo.project.name === 'mobile'
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
  });
  const client = await context.newPage();
  client.on('pageerror', (e) => errors.push(e.message));
  await client.goto('http://127.0.0.1:3000/');
  await client.getByRole('button', { name: '邀请码注册' }).click();
  const username = `browser_${testInfo.project.name}_${Date.now()}`;
  await client.getByLabel('用户名', { exact: true }).fill(username);
  await client.getByLabel('密码', { exact: true }).fill(fixturePassword);
  await client.getByLabel('邀请码', { exact: true }).fill(invite);
  await client.getByRole('button', { name: '创建账号' }).click();
  await expect(client.getByRole('heading', { name: '今天，从哪件事开始？' })).toBeVisible();
  await client.getByRole('button', { name: '长期任务库', exact: true }).click();
  for (const [title, note] of [
    ['读二十页书', '翻开一直想读的那本书'],
    ['练习英语', '从一句话开始'],
    ['运动十五分钟', '让身体也醒过来'],
    ['写下三个想法', '记录突然出现的灵感'],
  ]) {
    await client
      .locator('.page-heading')
      .getByRole('button', { name: '新增任务', exact: true })
      .click();
    await client.getByLabel('任务名称').fill(title);
    await client.getByLabel('一点备注').fill(note);
    await client.getByRole('button', { name: '加入任务库', exact: true }).click();
    await expect(client.getByRole('dialog')).toHaveCount(0);
  }
  await client.getByRole('button', { name: '我的今天', exact: true }).click();
  for (const title of ['读二十页书', '练习英语', '运动十五分钟', '写下三个想法']) {
    await client.locator('.selection-list').getByLabel(title, { exact: true }).click();
    await expect(
      client.locator('.selection-list').getByLabel(title, { exact: true }),
    ).toBeChecked();
    await expect(client.locator('.today-row').filter({ hasText: title })).toBeVisible();
  }
  await client.screenshot({
    path: `/tmp/turntable-${testInfo.project.name}-today.png`,
    fullPage: true,
  });
  const otherDevice = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const otherPage = await otherDevice.newPage();
  await otherPage.goto('http://127.0.0.1:3000/');
  await otherPage.getByLabel('用户名', { exact: true }).fill(username);
  await otherPage.getByLabel('密码', { exact: true }).fill(fixturePassword);
  await otherPage.getByRole('button', { name: '进入我的今天' }).click();
  await expect(otherPage.locator('.today-row')).toHaveCount(4);
  expect(
    await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await client.getByRole('button', { name: '随机抽取今日任务' }).click();
  await expect(client.getByRole('button', { name: '完成这件事' })).toBeVisible();
  await expect(otherPage.getByRole('button', { name: '完成这件事' })).toBeVisible();
  await expect(otherPage.getByRole('button', { name: '随机抽取今日任务' })).toBeDisabled();
  await expect(client.getByRole('button', { name: '随机抽取今日任务' })).toBeDisabled();
  await client.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(client.getByRole('button', { name: '继续计时' })).toBeVisible();
  await client.reload();
  await expect(client.getByRole('button', { name: '继续计时' })).toBeVisible();
  await client.getByRole('button', { name: '继续计时' }).click();
  await expect(client.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await client.screenshot({
    path: `/tmp/turntable-${testInfo.project.name}-focus.png`,
    fullPage: true,
  });
  await client.getByRole('button', { name: '完成这件事' }).click();
  await expect(client.locator('.completed-list')).toBeVisible();
  await expect(client.locator('.today-row')).toHaveCount(3);
  await expect(client.getByRole('button', { name: '随机抽取今日任务' })).toBeEnabled();
  await expect(otherPage.locator('.completed-list')).toBeVisible();
  await expect(otherPage.locator('.today-row')).toHaveCount(3);
  await client.getByRole('button', { name: '小小进步', exact: true }).click();
  await expect(client.getByRole('heading', { name: '小小进步，也算数.' })).toBeVisible();
  await expect(client.locator('.history-section tbody tr')).toHaveCount(4);
  await client.getByRole('button', { name: '年度', exact: true }).click();
  await expect(client.getByRole('img', { name: '每月完成任务趋势' })).toBeVisible();
  await client.getByRole('button', { name: '个人设置', exact: true }).click();
  await client.getByLabel('每段连续计时上限').fill('30');
  await client.getByLabel('希望完成多少件事').fill('2');
  await client.getByRole('button', { name: '保存设置' }).click();
  await expect(client.getByText(/已安排在 .* 生效/)).toBeVisible();
  await context.setOffline(true);
  await expect(
    client.getByText('暂时连接不上服务器，已暂停修改。计时以服务器记录为准，联网后自动同步。'),
  ).toBeVisible();
  await client.getByRole('button', { name: '我的今天', exact: true }).click();
  await expect(client.getByRole('button', { name: '随机抽取今日任务' })).toBeDisabled();
  await context.setOffline(false);
  await expect(client.getByRole('button', { name: '随机抽取今日任务' })).toBeEnabled();
  expect(errors).toEqual([]);

  await page.getByRole('button', { name: '用户账号', exact: true }).click();
  await page.getByRole('button', { name: `删除${username}`, exact: true }).click();
  await page.getByLabel('你的管理员密码').fill(fixturePassword);
  await page.getByLabel('输入目标用户名确认').fill(username);
  await page.getByRole('button', { name: '确认永久删除' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await client.reload();
  await expect(client.getByRole('heading', { name: '今天，也从这里开始' })).toBeVisible();
  await context.close();
  await otherDevice.close();
});
