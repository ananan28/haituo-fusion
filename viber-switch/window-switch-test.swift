import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

guard AXIsProcessTrusted() else { fputs("AX_UNTRUSTED: window switching requires macOS Accessibility permission\n", stderr); exit(10) }
let identifiers = (1...5).map { "com.haituo.viberpreview.slot\($0)" }
var apps: [NSRunningApplication] = []
var windows: [AXUIElement] = []
for identifier in identifiers {
    guard let running = NSRunningApplication.runningApplications(withBundleIdentifier: identifier).first else { fputs("Missing process\n", stderr); exit(1) }
    let ax = AXUIElementCreateApplication(running.processIdentifier)
    var raw: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(ax, kAXWindowsAttribute as CFString, &raw)
    guard result == .success, let list = raw as? [AXUIElement], let window = list.first else { fputs("AX_WINDOWS_UNAVAILABLE \(identifier) error=\(result.rawValue)\n", stderr); exit(2) }
    var settable = DarwinBoolean(false)
    let status = AXUIElementIsAttributeSettable(window, kAXMinimizedAttribute as CFString, &settable)
    print("AX_WINDOW \(identifier) settable=\(settable.boolValue) error=\(status.rawValue)")
    guard status == .success && settable.boolValue else { exit(3) }
    apps.append(running); windows.append(window)
}
func visibleCount(_ pid: pid_t) -> Int {
    guard let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return -1 }
    return rows.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }.count
}
for index in 0..<15 {
    let selected = index % apps.count
    for (i, window) in windows.enumerated() {
        let result = AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, (i != selected ? kCFBooleanTrue : kCFBooleanFalse))
        guard result == .success else { fputs("AX_MINIMIZE_FAILURE slot=\(i + 1) error=\(result.rawValue)\n", stderr); exit(4) }
    }
    _ = apps[selected].activate(options: [.activateAllWindows])
    Thread.sleep(forTimeInterval: 1)
    let counts = apps.map { visibleCount($0.processIdentifier) }
    print("SWITCH \(index + 1) selected=\(selected + 1) visible=\(counts)")
    guard counts[selected] > 0 && counts.enumerated().allSatisfy({ $0.offset == selected || $0.element == 0 }) else { fputs("WINDOW_SWITCH_MISMATCH\n", stderr); exit(5) }
}
print("WINDOW_SWITCH_OK 15 unlinked switches; real login, embedding and data isolation untested")
