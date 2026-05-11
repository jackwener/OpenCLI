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
});

describe('chatgpt-app AX model script', () => {
    it('supports english, zh-CN, and zh-TW options button labels', () => {
        expect(__test__.AX_MODEL_SCRIPT).toContain('findByDesc(win, "Options")');
        expect(__test__.AX_MODEL_SCRIPT).toContain('findByDesc(win, "选项")');
        expect(__test__.AX_MODEL_SCRIPT).toContain('findByDesc(win, "選項")');
    });
});

describe('chatgpt-app generating detection', () => {
    it('supports both english and zh-CN stop-generating labels', () => {
        expect(__test__.AX_GENERATING_SCRIPT).toContain('Stop generating');
        expect(__test__.AX_GENERATING_SCRIPT).toContain('停止生成');
    });
});
