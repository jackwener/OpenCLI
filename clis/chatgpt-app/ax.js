import { execFileSync, execSync } from 'node:child_process';
const AX_READ_SCRIPT = `
import Cocoa
import ApplicationServices

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
    return value as AnyObject?
}

func s(_ el: AXUIElement, _ name: String) -> String? {
    if let v = attr(el, name) as? String, !v.isEmpty { return v }
    return nil
}

func children(_ el: AXUIElement) -> [AXUIElement] {
    (attr(el, kAXChildrenAttribute as String) as? [AnyObject] ?? []).map { $0 as! AXUIElement }
}

func collectLists(_ el: AXUIElement, into out: inout [AXUIElement]) {
    let role = s(el, kAXRoleAttribute as String) ?? ""
    if role == kAXListRole as String { out.append(el) }
    for c in children(el) { collectLists(c, into: &out) }
}

func collectTexts(_ el: AXUIElement, into out: inout [String]) {
    let role = s(el, kAXRoleAttribute as String) ?? ""
    if role == kAXStaticTextRole as String {
        if let text = s(el, kAXDescriptionAttribute as String), !text.isEmpty {
            out.append(text)
        }
    }
    for c in children(el) { collectTexts(c, into: &out) }
}

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.chat").first else {
    fputs("ChatGPT not running\\n", stderr)
    exit(1)
}

let axApp = AXUIElementCreateApplication(app.processIdentifier)
guard let win = attr(axApp, kAXFocusedWindowAttribute as String) as! AXUIElement? else {
    fputs("No focused ChatGPT window\\n", stderr)
    exit(1)
}

var lists: [AXUIElement] = []
collectLists(win, into: &lists)

var best: [String] = []
for list in lists {
    var texts: [String] = []
    collectTexts(list, into: &texts)
    if texts.count > best.count {
        best = texts
    }
}

let data = try! JSONSerialization.data(withJSONObject: best, options: [])
print(String(data: data, encoding: .utf8)!)
`;
const AX_MODEL_SCRIPT = `
import Cocoa
import ApplicationServices

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
    return value as AnyObject?
}

func s(_ el: AXUIElement, _ name: String) -> String? {
    if let v = attr(el, name) as? String, !v.isEmpty { return v }
    return nil
}

func children(_ el: AXUIElement) -> [AXUIElement] {
    (attr(el, kAXChildrenAttribute as String) as? [AnyObject] ?? []).map { $0 as! AXUIElement }
}

func press(_ el: AXUIElement) {
    AXUIElementPerformAction(el, kAXPressAction as CFString)
}

func findByDesc(_ el: AXUIElement, _ target: String, prefix: Bool = false, depth: Int = 0) -> AXUIElement? {
    guard depth < 20 else { return nil }
    let desc = s(el, kAXDescriptionAttribute as String) ?? ""
    if prefix ? desc.hasPrefix(target) : (desc == target) { return el }
    for c in children(el) {
        if let found = findByDesc(c, target, prefix: prefix, depth: depth + 1) { return found }
    }
    return nil
}

func findPopover(_ el: AXUIElement, depth: Int = 0) -> AXUIElement? {
    guard depth < 20 else { return nil }
    let role = s(el, kAXRoleAttribute as String) ?? ""
    if role == "AXPopover" { return el }
    for c in children(el) {
        if let found = findPopover(c, depth: depth + 1) { return found }
    }
    return nil
}

func pressEscape() {
    let src = CGEventSource(stateID: .combinedSessionState)
    if let esc = CGEvent(keyboardEventSource: src, virtualKey: 0x35, keyDown: true) { esc.post(tap: .cghidEventTap) }
    if let esc = CGEvent(keyboardEventSource: src, virtualKey: 0x35, keyDown: false) { esc.post(tap: .cghidEventTap) }
}

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.chat").first else {
    fputs("ChatGPT not running\\n", stderr); exit(1)
}
let axApp = AXUIElementCreateApplication(app.processIdentifier)
guard let win = attr(axApp, kAXFocusedWindowAttribute as String) as! AXUIElement? else {
    fputs("No focused ChatGPT window\\n", stderr); exit(1)
}

let args = CommandLine.arguments
let target = args.count > 1 ? args[1] : ""
let needsLegacy = args.count > 2 && args[2] == "legacy"

// Step 1: Click the "Options" button to open the popover (support both English and Chinese UI)
var optionsBtn: AXUIElement? = nil
if let btn = findByDesc(win, "Options") { optionsBtn = btn }
else if let btn = findByDesc(win, "选项") { optionsBtn = btn }
guard let options = optionsBtn else {
    fputs("Could not find Options button\\n", stderr); exit(1)
}
press(options)
Thread.sleep(forTimeInterval: 0.8)

// Step 2: Find the popover that appeared, search ONLY within it
guard let popover = findPopover(win) else {
    pressEscape()
    fputs("Popover did not appear\\n", stderr); exit(1)
}

// Step 3: If legacy, click "Legacy models" to expand submenu
if needsLegacy {
    guard let legacyBtn = findByDesc(popover, "Legacy models") else {
        pressEscape()
        fputs("Could not find Legacy models button\\n", stderr); exit(1)
    }
    press(legacyBtn)
    Thread.sleep(forTimeInterval: 0.8)
}

// Step 4: Click the target model button within the popover (prefix match)
guard let modelBtn = findByDesc(popover, target, prefix: true) else {
    pressEscape()
    fputs("Could not find button starting with '\\(target)' in popover\\n", stderr); exit(1)
}
press(modelBtn)
print("Selected: \\(target)")
`;
const AX_GENERATING_SCRIPT = `
import Cocoa
import ApplicationServices

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
    return value as AnyObject?
}

func s(_ el: AXUIElement, _ name: String) -> String? {
    if let v = attr(el, name) as? String, !v.isEmpty { return v }
    return nil
}

func children(_ el: AXUIElement) -> [AXUIElement] {
    (attr(el, kAXChildrenAttribute as String) as? [AnyObject] ?? []).map { $0 as! AXUIElement }
}

func hasButton(_ el: AXUIElement, desc target: String, depth: Int = 0) -> Bool {
    guard depth < 15 else { return false }
    let role = s(el, kAXRoleAttribute as String) ?? ""
    let desc = s(el, kAXDescriptionAttribute as String) ?? ""
    if role == "AXButton" && desc == target { return true }
    for c in children(el) {
        if hasButton(c, desc: target, depth: depth + 1) { return true }
    }
    return false
}

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.chat").first else {
    print("false"); exit(0)
}
let axApp = AXUIElementCreateApplication(app.processIdentifier)
guard let win = attr(axApp, kAXFocusedWindowAttribute as String) as! AXUIElement? else {
    print("false"); exit(0)
}
print(hasButton(win, desc: "Stop generating") ? "true" : "false")
`;
const MODEL_MAP = {
    'auto': { desc: 'Auto' },
    'instant': { desc: 'Instant' },
    'thinking': { desc: 'Thinking' },
    '5.2-instant': { desc: 'GPT-5.2 Instant', legacy: true },
    '5.2-thinking': { desc: 'GPT-5.2 Thinking', legacy: true },
};
export const MODEL_CHOICES = Object.keys(MODEL_MAP);
export function activateChatGPT(delaySeconds = 0.5) {
    execSync("osascript -e 'tell application \"ChatGPT\" to activate'");
    execSync(`osascript -e 'delay ${delaySeconds}'`);
}
export function selectModel(model) {
    const entry = MODEL_MAP[model];
    if (!entry) {
        throw new Error(`Unknown model "${model}". Choose from: ${MODEL_CHOICES.join(', ')}`);
    }
    const swiftArgs = ['-', entry.desc];
    if (entry.legacy)
        swiftArgs.push('legacy');
    const output = execFileSync('swift', swiftArgs, {
        input: AX_MODEL_SCRIPT,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
    }).trim();
    return output;
}
export function isGenerating() {
    try {
        const output = execFileSync('swift', ['-'], {
            input: AX_GENERATING_SCRIPT,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        }).trim();
        return output === 'true';
    }
    catch {
        return false;
    }
}
export function getVisibleChatMessages() {
    const output = execFileSync('swift', ['-'], {
        input: AX_READ_SCRIPT,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
    }).trim();
    if (!output)
        return [];
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed))
        return [];
    return parsed
        .filter((item) => typeof item === 'string')
        .map((item) => item.replace(/[\uFFFC\u200B-\u200D\uFEFF]/g, '').trim())
        .filter((item) => item.length > 0);
}
