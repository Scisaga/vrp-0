import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const componentPath = path.resolve(testDirectory, "../assets/js/components/date-time-24-input.js");

test("date-time control keeps 00-23 hour values without relying on the browser locale", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ locale: "en-US" });
    await page.setContent(`
      <vrp-date-time-24 id="value" seconds></vrp-date-time-24>
      <vrp-date-time-24 id="minutes"></vrp-date-time-24>
    `);
    await page.addScriptTag({ path: componentPath, type: "module" });
    await page.waitForFunction(() => Boolean(customElements.get("vrp-date-time-24")));

    const initial = await page.locator("#value").evaluate((element) => {
      element.value = "2026-07-16T21:34:30";
      return {
        value: element.value,
        display: element.querySelector(".datetime24-value")?.value,
        textInputCount: element.querySelectorAll('input[type="text"]').length,
        nativeDateTimeCount: element.querySelectorAll('input[type="date"], input[type="datetime-local"], input[type="time"]').length,
        pickerCount: element.querySelectorAll('.datetime24-picker').length
      };
    });
    assert.deepEqual(initial, {
      value: "2026-07-16T21:34:30",
      display: "2026-07-16 21:34:30",
      textInputCount: 1,
      nativeDateTimeCount: 0,
      pickerCount: 1
    });

    const edited = await page.locator("#value").evaluate((element) => {
      let inputEventTarget = "";
      element.addEventListener("input", (event) => { inputEventTarget = event.target.localName; });
      const input = element.querySelector(".datetime24-value");
      input.value = "2026-07-16 23:34:30";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return { value: element.value, inputEventTarget };
    });
    assert.deepEqual(edited, { value: "2026-07-16T23:34:30", inputEventTarget: "vrp-date-time-24" });

    await page.locator("#value .datetime24-calendar-trigger").click();
    await page.locator('#value [data-picker-action="select-date"][data-date="2026-07-29"]').click();
    await page.locator('#value [data-time-unit="hour"][data-time-value="22"]').click();
    await page.locator('#value [data-time-unit="minute"][data-time-value="15"]').click();
    await page.locator('#value [data-time-unit="second"][data-time-value="45"]').click();
    await page.locator('#value [data-picker-action="confirm"]').click();
    const calendarEdited = await page.locator("#value").evaluate((element) => ({
      value: element.value,
      display: element.querySelector(".datetime24-value").value,
      expanded: element.querySelector(".datetime24-calendar-trigger").getAttribute("aria-expanded")
    }));
    assert.deepEqual(calendarEdited, {
      value: "2026-07-29T22:15:45",
      display: "2026-07-29 22:15:45",
      expanded: "false"
    });

    const rejected = await page.locator("#value").evaluate((element) => {
      const input = element.querySelector(".datetime24-value");
      input.value = "2026-07-29 24:34:30";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return { value: element.value, invalid: input.hasAttribute("aria-invalid") };
    });
    assert.deepEqual(rejected, { value: "2026-07-29T22:15:45", invalid: true });

    const minutesOnly = await page.locator("#minutes").evaluate((element) => {
      element.value = "2026-07-16T23:45:59";
      return {
        value: element.value,
        display: element.querySelector(".datetime24-value")?.value
      };
    });
    assert.deepEqual(minutesOnly, { value: "2026-07-16T23:45", display: "2026-07-16 23:45" });
  } finally {
    await browser.close();
  }
});
