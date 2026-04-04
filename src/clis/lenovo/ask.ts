import { cli, Strategy } from '../../registry.js';

cli({
  site: 'lenovo',
  name: 'ask',
  description: '联想乐享AI问答',
  domain: 'leai.lenovo.com.cn',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'question', type: 'string', required: true, help: '你的问题' },
  ],
  columns: ['question', 'answer'],
  func: async (page: any, kwargs: any) => {
    const { question } = kwargs;
    await page.goto('https://leai.lenovo.com.cn', { waitUntil: 'networkidle' });

    // 点"开启新对话"然后刷新页面，让 SPA 正确渲染对话组件
    await page.evaluate(`(function(){ document.querySelector(".top-box")?.click(); })()`);
    await new Promise(r => setTimeout(r, 1000));
    await page.evaluate(`(function(){ location.reload(); })()`);

    // 等待输入框出现
    let inputFound = false;
    for (let w = 0; w < 15; w++) {
      await new Promise(r => setTimeout(r, 1000));
      inputFound = await page.evaluate(`(function(){ return !!document.querySelector(".van-field__control"); })()`);
      if (inputFound) break;
    }
    if (!inputFound) return [{ question, answer: '输入框未加载' }];

    // 记录当前回复数
    const baseCount = await page.evaluate(`(function(){
      return document.querySelectorAll(".response-text").length;
    })()`);

    // 输入问题
    await page.evaluate(`(function(){
      var input = document.querySelector(".van-field__control");
      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(question)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await new Promise(r => setTimeout(r, 500));

    // 回车发送
    await page.evaluate(`(function(){
      var input = document.querySelector(".van-field__control");
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    })()`);

    // 等待新回复
    let answer = '';
    let prevLen = 0;
    let stableCount = 0;
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const result = await page.evaluate(`(function(){
        var responses = document.querySelectorAll(".response-text");
        if (responses.length <= ${baseCount}) return "";
        return responses[responses.length - 1].textContent.trim();
      })()`);
      if (result && result.length > 0) {
        answer = result;
        if (answer.length === prevLen) {
          stableCount++;
          if (stableCount >= 2) break;
        } else {
          stableCount = 0;
        }
        prevLen = answer.length;
      }
    }

    return [{ question, answer: answer || '等待回复超时' }];
  },
});
