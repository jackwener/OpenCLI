import { describe, expect, it } from 'vitest';
import { __test__ } from './ax.js';

describe('chatgpt-app AX send script', () => {
    it('prefers the focused composer before falling back to the last editable input', () => {
        expect(__test__.AX_SEND_SCRIPT).toContain('kAXFocusedUIElementAttribute');
    });

    it('fails fast when the AX set does not round-trip into the composer value', () => {
        expect(__test__.AX_SEND_SCRIPT).toContain('Failed to verify input value after AX set');
    });

    it('does not report success until the prompt leaves the composer after send', () => {
        expect(__test__.AX_SEND_SCRIPT).toContain('Prompt did not leave input after pressing send');
    });

    it('supports english, zh-CN, and zh-TW send button labels', () => {
        expect(__test__.AX_SEND_SCRIPT).toContain('["发送", "傳送", "Send"]');
    });

    it('supports loading an optional image and writing it to the general pasteboard', () => {
        expect(__test__.AX_SEND_SCRIPT).toContain('NSImage(contentsOfFile: imagePath)');
        expect(__test__.AX_SEND_SCRIPT).toContain('NSPasteboard.general');
        expect(__test__.AX_SEND_SCRIPT).toContain('pasteboard.clearContents()');
        expect(__test__.AX_SEND_SCRIPT).toContain('pasteboard.writeObjects([image])');
    });

    it('simulates Cmd + V paste via CGEvent targeted directly to the ChatGPT process', () => {
        expect(__test__.AX_SEND_SCRIPT).toContain('CGEventSource(stateID: .hidSystemState)');
        expect(__test__.AX_SEND_SCRIPT).toContain('let cmdDown = CGEvent');
        expect(__test__.AX_SEND_SCRIPT).toContain('.maskCommand');
        expect(__test__.AX_SEND_SCRIPT).toContain('virtualKey: 0x09'); // 'V'
        expect(__test__.AX_SEND_SCRIPT).toContain('virtualKey: 0x37'); // 'Cmd'
        expect(__test__.AX_SEND_SCRIPT).toContain('postToPid(app.processIdentifier)');
    });

    it('uses a dynamic submission check with valueBeforeSend to handle rich content correctly', () => {
        expect(__test__.AX_SEND_SCRIPT).toContain('let valueBeforeSend = s(input, kAXValueAttribute as String)');
        expect(__test__.AX_SEND_SCRIPT).toContain('(s(input, kAXValueAttribute as String) ?? "") != valueBeforeSend');
    });

    it('safeguards user clipboard by backing up and restoring pasteboard contents', () => {
        expect(__test__.AX_SEND_SCRIPT).toContain('pasteboard.pasteboardItems');
        expect(__test__.AX_SEND_SCRIPT).toContain('NSPasteboardItem()');
        expect(__test__.AX_SEND_SCRIPT).toContain('savedItems.append');
        expect(__test__.AX_SEND_SCRIPT).toContain('pasteboard.writeObjects(savedItems)');
    });

    it('uses safe casting and fallback window search to prevent runtime crashes', () => {
        expect(__test__.AX_SEND_SCRIPT).toContain('as! AXUIElement');
        expect(__test__.AX_SEND_SCRIPT).toContain('kAXWindowsAttribute');
    });
});

describe('chatgpt-app AX model script', () => {
    it('supports english, zh-CN, and zh-TW options button labels', () => {
        expect(__test__.AX_MODEL_SCRIPT).toContain('["Options", "选项", "選項"]');
    });

    it('utilizes dynamic element polling helper to prevent rigid sleep delays', () => {
        expect(__test__.AX_MODEL_SCRIPT).toContain('waitForElement');
    });

    it('supports localized legacy model menus for Chinese systems', () => {
        expect(__test__.AX_MODEL_SCRIPT).toContain('["Legacy models", "经典模型", "經典模型"]');
    });
});

describe('chatgpt-app generating detection', () => {
    it('supports english, zh-CN, and zh-TW stop-generating labels', () => {
        expect(__test__.AX_GENERATING_SCRIPT).toContain('Stop generating');
        expect(__test__.AX_GENERATING_SCRIPT).toContain('停止生成');
        expect(__test__.AX_GENERATING_SCRIPT).toContain('停止產生');
        expect(__test__.AX_GENERATING_SCRIPT).toContain('停止傳送');
    });
});
