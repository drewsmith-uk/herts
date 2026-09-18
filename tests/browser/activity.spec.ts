import { test, expect } from '@playwright/test';

for (const width of [390, 1280]) test(`groups tool rounds and holds disclosure headers in place on ${width}px screens`, async ({page,request}) => {
  await page.setViewportSize({width,height:844});
  const before = await (await request.get('http://127.0.0.1:8791/calls')).json();
  await page.goto('/#/conversation/tool-activity');
  const group = page.locator('.activity-group');
  const toggle = group.getByRole('button',{name:/Hermes activity/});
  await expect(group).toHaveCount(1);
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(page.getByText('All files have been checked.',{exact:true})).toBeInViewport();
  await expect(page.getByRole('button',{name:'View tool output',exact:true})).toHaveCount(0);
  await toggle.scrollIntoViewIfNeeded();
  const top = await toggle.evaluate(el=>el.getBoundingClientRect().top);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect.poll(async()=>Math.abs(await toggle.evaluate(el=>el.getBoundingClientRect().top)-top)).toBeLessThan(5);
  await expect(toggle).toBeInViewport();
  await expect(group.getByRole('button',{name:'View tool output',exact:true})).toHaveCount(100);
  // The first tool output in this latest window has its call in the older page.
  const output = group.getByRole('button',{name:'View tool output',exact:true}).first();
  const outputTop = await output.evaluate(el=>el.getBoundingClientRect().top);
  await output.click();
  await expect(output).toHaveAttribute('aria-expanded','true');
  await expect.poll(async()=>Math.abs(await output.evaluate(el=>el.getBoundingClientRect().top)-outputTop)).toBeLessThan(5);
  await output.click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  // Keyboard expansion is anchored too; paging merges into this same open group.
  await toggle.focus(); await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await page.getByRole('button',{name:'Load older messages',exact:true}).click();
  await expect(group).toHaveCount(1);
  await expect(toggle).toContainText('110 tool calls');
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect(group.getByRole('button',{name:'View tool output',exact:true})).toHaveCount(110);
  await expect(page.getByText('Please check these files.',{exact:true})).toBeAttached();
  await toggle.scrollIntoViewIfNeeded(); await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  const after = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(after.slice(before.length).filter((method:string)=>['session.create','session.resume','prompt.submit'].includes(method))).toEqual([]);
});
