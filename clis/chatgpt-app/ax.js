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
var targetWin: AXUIElement? = nil
if let focused = attr(axApp, kAXFocusedWindowAttribute as String) {
    targetWin = (focused as! AXUIElement)
}
if targetWin == nil {
    if let windows = attr(axApp, kAXWindowsAttribute as String) as? [AXUIElement], !windows.isEmpty {
        targetWin = windows.first
    }
}
guard let win = targetWin else {
    fputs("Could not find or focus any ChatGPT window\\n", stderr)
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
const AX_SEND_SCRIPT = `
import Cocoa
import ApplicationServices

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
    return value as AnyObject?
}

func s(_ el: AXUIElement, _ name: String) -> String? {
    if let v = attr(el, name) as? String { return v }
    return nil
}

func isEnabled(_ el: AXUIElement) -> Bool {
    (attr(el, kAXEnabledAttribute as String) as? Bool) ?? true
}

func children(_ el: AXUIElement) -> [AXUIElement] {
    (attr(el, kAXChildrenAttribute as String) as? [AnyObject] ?? []).map { $0 as! AXUIElement }
}

func collectEditableInputs(_ el: AXUIElement, into out: inout [AXUIElement], depth: Int = 0) {
    guard depth < 25 else { return }
    let role = s(el, kAXRoleAttribute as String) ?? ""
    if (role == kAXTextAreaRole as String || role == kAXTextFieldRole as String) && isEnabled(el) {
        out.append(el)
    }
    for c in children(el) { collectEditableInputs(c, into: &out, depth: depth + 1) }
}

func isInput(_ el: AXUIElement) -> Bool {
    let role = s(el, kAXRoleAttribute as String) ?? ""
    return role == kAXTextAreaRole as String || role == kAXTextFieldRole as String
}

func focusedInput(_ axApp: AXUIElement) -> AXUIElement? {
    guard let focused = attr(axApp, kAXFocusedUIElementAttribute as String) else {
        return nil
    }
    let focusedEl = focused as! AXUIElement
    return isInput(focusedEl) && isEnabled(focusedEl) ? focusedEl : nil
}

func findByDescriptions(_ el: AXUIElement, _ targets: [String], depth: Int = 0) -> AXUIElement? {
    guard depth < 25 else { return nil }
    let role = s(el, kAXRoleAttribute as String) ?? ""
    let desc = s(el, kAXDescriptionAttribute as String) ?? ""
    if role == "AXButton" && targets.contains(desc) && isEnabled(el) { return el }
    for c in children(el) {
        if let found = findByDescriptions(c, targets, depth: depth + 1) { return found }
    }
    return nil
}

func attachmentEvidenceCount(_ el: AXUIElement, fileName: String, depth: Int = 0) -> Int {
    guard depth < 25 else { return 0 }
    let role = s(el, kAXRoleAttribute as String) ?? ""
    let desc = s(el, kAXDescriptionAttribute as String) ?? ""
    let title = s(el, kAXTitleAttribute as String) ?? ""
    let value = s(el, kAXValueAttribute as String) ?? ""
    let help = s(el, kAXHelpAttribute as String) ?? ""
    let haystack = [desc, title, value, help].joined(separator: " ")
    var count = role == kAXImageRole as String ? 1 : 0
    if !fileName.isEmpty && haystack.localizedCaseInsensitiveContains(fileName) {
        count += 1
    }
    for c in children(el) {
        count += attachmentEvidenceCount(c, fileName: fileName, depth: depth + 1)
    }
    return count
}

func press(_ el: AXUIElement) {
    AXUIElementPerformAction(el, kAXPressAction as CFString)
}

let args = CommandLine.arguments
guard args.count > 1 else {
    fputs("Missing prompt text\\n", stderr)
    exit(1)
}
let text = args[1]
let imagePath = args.count > 2 ? args[2] : ""

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.chat").first else {
    fputs("ChatGPT not running\\n", stderr)
    exit(1)
}

let axApp = AXUIElementCreateApplication(app.processIdentifier)
var targetWin: AXUIElement? = nil
if let focused = attr(axApp, kAXFocusedWindowAttribute as String) {
    targetWin = (focused as! AXUIElement)
}
if targetWin == nil {
    if let windows = attr(axApp, kAXWindowsAttribute as String) as? [AXUIElement], !windows.isEmpty {
        targetWin = windows.first
    }
}
guard let win = targetWin else {
    fputs("Could not find or focus any ChatGPT window\\n", stderr)
    exit(1)
}

var inputs: [AXUIElement] = []
collectEditableInputs(win, into: &inputs)
guard let input = focusedInput(axApp) ?? inputs.last else {
    fputs("Could not find editable input area\\n", stderr)
    exit(1)
}

guard AXUIElementSetAttributeValue(input, kAXValueAttribute as CFString, text as CFTypeRef) == .success else {
    fputs("Failed to set input value\\n", stderr)
    exit(1)
}

Thread.sleep(forTimeInterval: 0.2)

guard s(input, kAXValueAttribute as String) == text else {
    fputs("Failed to verify input value after AX set\\n", stderr)
    exit(1)
}

if !imagePath.isEmpty {
    guard let image = NSImage(contentsOfFile: imagePath) else {
        fputs("Failed to load image from path: \(imagePath)\\n", stderr)
        exit(1)
    }
    let fileName = URL(fileURLWithPath: imagePath).lastPathComponent
    let attachmentCountBefore = attachmentEvidenceCount(win, fileName: fileName)

    // Safeguard Clipboard: Backup existing clipboard items
    let pasteboard = NSPasteboard.general
    var savedItems: [NSPasteboardItem] = []
    if let items = pasteboard.pasteboardItems {
        for item in items {
            let savedItem = NSPasteboardItem()
            for type in item.types {
                if let data = item.data(forType: type) {
                    savedItem.setData(data, forType: type)
                }
            }
            savedItems.append(savedItem)
        }
    }
    func restorePasteboard() {
        pasteboard.clearContents()
        if !savedItems.isEmpty {
            pasteboard.writeObjects(savedItems)
        }
    }

    pasteboard.clearContents()
    pasteboard.writeObjects([image])

    AXUIElementSetAttributeValue(input, kAXFocusedAttribute as CFString, true as CFTypeRef)
    Thread.sleep(forTimeInterval: 0.2)

    // Simulate paste command targeted directly to ChatGPT's PID to prevent global interference
    let src = CGEventSource(stateID: .hidSystemState)
    let cmdDown = CGEvent(keyboardEventSource: src, virtualKey: 0x37, keyDown: true)
    cmdDown?.flags = .maskCommand
    cmdDown?.postToPid(app.processIdentifier)

    let vDown = CGEvent(keyboardEventSource: src, virtualKey: 0x09, keyDown: true)
    vDown?.flags = .maskCommand
    vDown?.postToPid(app.processIdentifier)

    let vUp = CGEvent(keyboardEventSource: src, virtualKey: 0x09, keyDown: false)
    vUp?.flags = .maskCommand
    vUp?.postToPid(app.processIdentifier)

    let cmdUp = CGEvent(keyboardEventSource: src, virtualKey: 0x37, keyDown: false)
    cmdUp?.postToPid(app.processIdentifier)

    var attachmentReady = false
    for _ in 0..<80 {
        Thread.sleep(forTimeInterval: 0.1)
        if attachmentEvidenceCount(win, fileName: fileName) > attachmentCountBefore {
            attachmentReady = true
            break
        }
    }

    // Safeguard Clipboard: Restore user clipboard content after the paste flow.
    restorePasteboard()

    guard attachmentReady else {
        fputs("Image attachment did not appear in ChatGPT before send\\n", stderr)
        exit(1)
    }
}

let valueBeforeSend = s(input, kAXValueAttribute as String) ?? ""

guard let sendButton = findByDescriptions(win, ["发送", "傳送", "Send"]) else {
    fputs("Could not find send button\\n", stderr)
    exit(1)
}

press(sendButton)

var submitted = false
for _ in 0..<15 {
    Thread.sleep(forTimeInterval: 0.1)
    if (s(input, kAXValueAttribute as String) ?? "") != valueBeforeSend {
        submitted = true
        break
    }
}

guard submitted else {
    fputs("Prompt did not leave input after pressing send\\n", stderr)
    exit(1)
}

print("Sent")
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

func waitForElement(timeout: TimeInterval = 1.2, check: () -> AXUIElement?) -> AXUIElement? {
    let start = Date()
    while Date().timeIntervalSince(start) < timeout {
        if let el = check() { return el }
        Thread.sleep(forTimeInterval: 0.05)
    }
    return nil
}

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.chat").first else {
    fputs("ChatGPT not running\\n", stderr); exit(1)
}
let axApp = AXUIElementCreateApplication(app.processIdentifier)
var targetWin: AXUIElement? = nil
if let focused = attr(axApp, kAXFocusedWindowAttribute as String) {
    targetWin = (focused as! AXUIElement)
}
if targetWin == nil {
    if let windows = attr(axApp, kAXWindowsAttribute as String) as? [AXUIElement], !windows.isEmpty {
        targetWin = windows.first
    }
}
guard let win = targetWin else {
    fputs("Could not find or focus any ChatGPT window\\n", stderr); exit(1)
}

let args = CommandLine.arguments
let target = args.count > 1 ? args[1] : ""
let needsLegacy = args.count > 2 && args[2] == "legacy"

// Step 1: Click the "Options" button to open the popover (support English, Simplified and Traditional Chinese UI)
var optionsBtn: AXUIElement? = nil
for label in ["Options", "选项", "選項"] {
    if let btn = findByDesc(win, label) {
        optionsBtn = btn
        break
    }
}
guard let options = optionsBtn else {
    fputs("Could not find Options button\\n", stderr); exit(1)
}
press(options)

// Step 2: Find the popover that appeared, search ONLY within it (utilizing dynamic polling helper)
guard let popover = waitForElement(check: { findPopover(win) }) else {
    pressEscape()
    fputs("Popover did not appear\\n", stderr); exit(1)
}

// Step 3: If legacy, click "Legacy models" to expand submenu (supports EN/CN/TW localizations)
if needsLegacy {
    var legacyBtn: AXUIElement? = nil
    for label in ["Legacy models", "经典模型", "經典模型"] {
        if let btn = findByDesc(popover, label) {
            legacyBtn = btn
            break
        }
    }
    guard let btn = legacyBtn else {
        pressEscape()
        fputs("Could not find Legacy models button\\n", stderr); exit(1)
    }
    press(btn)
}

// Step 4: Click the target model button within the popover (prefix match via dynamic polling helper)
guard let modelBtn = waitForElement(check: { findByDesc(popover, target, prefix: true) }) else {
    pressEscape()
    fputs("Could not find button starting with '\(target)'\\n", stderr); exit(1)
}
press(modelBtn)
print("Selected: \(target)")
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
var targetWin: AXUIElement? = nil
if let focused = attr(axApp, kAXFocusedWindowAttribute as String) {
    targetWin = (focused as! AXUIElement)
}
if targetWin == nil {
    if let windows = attr(axApp, kAXWindowsAttribute as String) as? [AXUIElement], !windows.isEmpty {
        targetWin = windows.first
    }
}
guard let win = targetWin else {
    print("false"); exit(0)
}
let targets = ["Stop generating", "停止生成", "停止產生", "停止傳送"]
print(targets.contains(where: { hasButton(win, desc: $0) }) ? "true" : "false")
`;
const AX_TEMPORARY_CHAT_SCRIPT = `
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

func hasTemporaryChatText(_ el: AXUIElement, depth: Int = 0) -> Bool {
    guard depth < 25 else { return false }
    let haystack = [
        s(el, kAXDescriptionAttribute as String) ?? "",
        s(el, kAXTitleAttribute as String) ?? "",
        s(el, kAXValueAttribute as String) ?? "",
        s(el, kAXHelpAttribute as String) ?? "",
    ].joined(separator: " ")
    let labels = ["Temporary Chat", "临时聊天", "臨時聊天", "临时对话", "臨時對話"]
    if labels.contains(where: { haystack.localizedCaseInsensitiveContains($0) }) {
        return true
    }
    for c in children(el) {
        if hasTemporaryChatText(c, depth: depth + 1) { return true }
    }
    return false
}

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.chat").first else {
    print("false"); exit(0)
}
let axApp = AXUIElementCreateApplication(app.processIdentifier)
var targetWin: AXUIElement? = nil
if let focused = attr(axApp, kAXFocusedWindowAttribute as String) {
    targetWin = (focused as! AXUIElement)
}
if targetWin == nil {
    if let windows = attr(axApp, kAXWindowsAttribute as String) as? [AXUIElement], !windows.isEmpty {
        targetWin = windows.first
    }
}
guard let win = targetWin else {
    print("false"); exit(0)
}
print(hasTemporaryChatText(win) ? "true" : "false")
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
export function sendPrompt(text, imagePath = '') {
    const args = ['-', text];
    if (imagePath) {
        args.push(imagePath);
    }
    return execFileSync('swift', args, {
        input: AX_SEND_SCRIPT,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
    }).trim();
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
export function isTemporaryChatVisible() {
    try {
        const output = execFileSync('swift', ['-'], {
            input: AX_TEMPORARY_CHAT_SCRIPT,
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
export const __test__ = {
    AX_SEND_SCRIPT,
    AX_MODEL_SCRIPT,
    AX_GENERATING_SCRIPT,
    AX_TEMPORARY_CHAT_SCRIPT,
};
