import { cli, Strategy } from '@jackwener/opencli/registry';

export const sendCommand = cli({
  site: 'antigravity',
  name: 'send',
  description: 'Send a message to Antigravity AI via the internal Lexical editor',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'message', help: 'The message text to send', required: true, positional: true }
  ],
  columns: ['Status', 'Message'],
  func: async (page, kwargs) => {
    const text = kwargs.message;

    // We use evaluate to focus and insert text because Lexical editors maintain
    // absolute control over their DOM and don't respond to raw node.textContent.
    // document.execCommand simulates a native paste/typing action perfectly.
    await page.evaluate(`
      async () => {
        const container = document.getElementById('antigravity.agentSidePanelInputBox');
        if (!container) throw new Error('Could not find antigravity.agentSidePanelInputBox');
        const editor = container.querySelector('[data-lexical-editor="true"]');
        if (!editor) throw new Error('Could not find Antigravity input box');
        
        editor.focus();
        document.execCommand('insertText', false, ${JSON.stringify(text)});
      }
    `);
    
    // Wait for the React/Lexical state to flush the new input
    await page.wait(0.5);
    
    // Press Enter to submit the message
    await page.pressKey('Enter');
    
    return [{ Status: 'Sent successfully', Message: text }];
  },
});
