import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

function installDom(html: string): Document {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  return dom.window.document;
}

function dispatchNativeMouseSequence(target: Element): void {
  for (const type of ['mousemove', 'pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click']) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
}

describe('CDP-primary click dropdown fixtures', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
  });

  it('captures the Radix/shadcn class of dropdowns that open on pointerdown and select on pointerup', () => {
    const document = installDom(`
      <button id="trigger" role="combobox" aria-expanded="false">Category</button>
      <div id="portal-root"></div>
      <output id="value"></output>
    `);
    const trigger = document.querySelector('#trigger') as HTMLButtonElement;
    const portal = document.querySelector('#portal-root')!;
    const value = document.querySelector('#value')!;

    trigger.addEventListener('pointerdown', () => {
      trigger.setAttribute('aria-expanded', 'true');
      portal.innerHTML = `
        <div role="listbox">
          <div id="meals" role="option">Meals</div>
        </div>
      `;
      portal.querySelector('#meals')!.addEventListener('pointerup', () => {
        value.textContent = 'Meals';
        trigger.textContent = 'Meals';
        trigger.setAttribute('aria-expanded', 'false');
      });
    });

    // Baseline: DOM el.click() dispatches click only. This is the old OpenCLI
    // failure mode: the command reports success but the dropdown never opens.
    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(portal.querySelector('[role="option"]')).toBeNull();
    expect(value.textContent).toBe('');

    // CDP-style mouse input opens the portal and can commit the option.
    dispatchNativeMouseSequence(trigger);
    const option = portal.querySelector('#meals')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    dispatchNativeMouseSequence(option);
    expect(value.textContent).toBe('Meals');
    expect(trigger.textContent).toBe('Meals');
  });

  it('captures the MUI autocomplete class that opens on mousedown and commits on mousedown in a popper', () => {
    const document = installDom(`
      <label for="category">Category</label>
      <input id="category" role="combobox" value="" />
      <div id="mui-popper"></div>
      <output id="value"></output>
    `);
    const input = document.querySelector('#category') as HTMLInputElement;
    const popper = document.querySelector('#mui-popper')!;
    const value = document.querySelector('#value')!;

    input.addEventListener('mousedown', () => {
      popper.innerHTML = `
        <ul role="listbox">
          <li id="travel" role="option">Travel</li>
        </ul>
      `;
      popper.querySelector('#travel')!.addEventListener('mousedown', () => {
        input.value = 'Travel';
        value.textContent = 'Travel';
      });
    });

    input.click();
    expect(popper.querySelector('[role="option"]')).toBeNull();
    expect(input.value).toBe('');

    dispatchNativeMouseSequence(input);
    const option = popper.querySelector('#travel')!;
    dispatchNativeMouseSequence(option);

    expect(input.value).toBe('Travel');
    expect(value.textContent).toBe('Travel');
  });
});
