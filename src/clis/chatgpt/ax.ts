import { execFileSync } from 'node:child_process';

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

export function getVisibleChatMessages(): string[] {
  const output = execFileSync('swift', ['-'], {
    input: AX_READ_SCRIPT,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  }).trim();

  if (!output) return [];

  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.replace(/[\uFFFC\u200B-\u200D\uFEFF]/g, '').trim())
    .filter((item) => item.length > 0);
}
