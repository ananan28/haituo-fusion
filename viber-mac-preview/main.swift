import AppKit
import Foundation

let slotCount = 5
func bundleID(_ slot: Int) -> String { "com.haituo.viberpreview.slot\(slot)" }
func run(_ executable: String, _ arguments: [String]) throws -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = pipe
    try process.run()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    let output = String(data: data, encoding: .utf8) ?? ""
    if process.terminationStatus != 0 { throw NSError(domain: "HaituoPreview", code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: "\(URL(fileURLWithPath: executable).lastPathComponent) 失败：\(output.prefix(600))"]) }
    return output
}
func supportRoot() throws -> URL {
    let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    return base.appendingPathComponent("HaituoViberPreview", isDirectory: true)
}
func prepare(_ slot: Int) throws -> URL {
    let fm = FileManager.default
    let official = URL(fileURLWithPath: "/Applications/Viber.app", isDirectory: true)
    guard let info = NSDictionary(contentsOf: official.appendingPathComponent("Contents/Info.plist")), let identifier = info["CFBundleIdentifier"] as? String, identifier == "com.viber.osx", let version = info["CFBundleShortVersionString"] as? String, version != "1.0.0.110" else { throw NSError(domain: "HaituoPreview", code: 1, userInfo: [NSLocalizedDescriptionKey: "请先将官方 Viber 安装到“应用程序”，打开一次并等待安装更新完成。"])}
    _ = try run("/usr/bin/codesign", ["--verify", "--deep", "--strict", official.path])
    let root = try supportRoot().appendingPathComponent("profiles", isDirectory: true)
    try fm.createDirectory(at: root, withIntermediateDirectories: true)
    let dir = root.appendingPathComponent("slot-\(slot)", isDirectory: true)
    try fm.createDirectory(at: dir, withIntermediateDirectories: true)
    let target = dir.appendingPathComponent("Viber.app", isDirectory: true)
    if fm.fileExists(atPath: target.path) {
        guard let saved = NSDictionary(contentsOf: target.appendingPathComponent("Contents/Info.plist")), saved["CFBundleIdentifier"] as? String == bundleID(slot) else { throw NSError(domain: "HaituoPreview", code: 2, userInfo: [NSLocalizedDescriptionKey: "账号目录中的程序不符合预期，请保留数据并联系技术人员。"])}
        _ = try run("/usr/bin/codesign", ["--verify", "--deep", "--strict", target.path])
        return target
    }
    let staging = dir.appendingPathComponent("Viber-\(UUID().uuidString).app", isDirectory: true)
    defer { try? fm.removeItem(at: staging) }
    try fm.copyItem(at: official, to: staging)
    let plistURL = staging.appendingPathComponent("Contents/Info.plist")
    guard let original = NSMutableDictionary(contentsOf: plistURL) else { throw NSError(domain: "HaituoPreview", code: 3, userInfo: [NSLocalizedDescriptionKey: "无法读取 Viber 的应用配置。"])}
    original["CFBundleIdentifier"] = bundleID(slot)
    guard original.write(to: plistURL, atomically: true) else { throw NSError(domain: "HaituoPreview", code: 4, userInfo: [NSLocalizedDescriptionKey: "无法写入独立应用标识。"])}
    let entitlements = dir.appendingPathComponent("sandbox-\(UUID().uuidString).plist")
    defer { try? fm.removeItem(at: entitlements) }
    let config: [String: Any] = ["com.apple.security.app-sandbox": true, "com.apple.security.network.client": true, "com.apple.security.network.server": true]
    try PropertyListSerialization.data(fromPropertyList: config, format: .xml, options: 0).write(to: entitlements, options: .atomic)
    _ = try run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", "--entitlements", entitlements.path, staging.path])
    _ = try run("/usr/bin/codesign", ["--verify", "--deep", "--strict", staging.path])
    try fm.moveItem(at: staging, to: target)
    return target
}
final class Delegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var status: NSTextField!
    var buttons: [NSButton] = []
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 580, height: 355), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "海拓 Viber 多开验证版"
        window.center()
        let view = window.contentView!
        let title = NSTextField(labelWithString: "Viber 多开验证版 · macOS")
        title.font = .boldSystemFont(ofSize: 21); title.frame = NSRect(x: 24, y: 306, width: 530, height: 28); view.addSubview(title)
        let note = NSTextField(wrappingLabelWithString: "先安装并打开官方 Viber 完成更新。每个按钮创建独立测试副本。首次打开可能需要几分钟；两个真实账号的登录和数据隔离尚未验证。")
        note.frame = NSRect(x: 24, y: 239, width: 530, height: 60); view.addSubview(note)
        for slot in 1...slotCount {
            let button = NSButton(title: "打开 Viber \(slot)", target: self, action: #selector(openSlot(_:)))
            button.tag = slot; button.frame = NSRect(x: 24 + (slot-1)*106, y: 185, width: 100, height: 36)
            view.addSubview(button); buttons.append(button)
        }
        status = NSTextField(wrappingLabelWithString: "就绪。只用于测试；未验证聊天翻译及真实多账号。")
        status.frame = NSRect(x: 24, y: 93, width: 530, height: 70); view.addSubview(status)
        let foot = NSTextField(wrappingLabelWithString: "测试副本位于本机应用支持目录；不会替换官方 Viber 或海拓。")
        foot.font = .systemFont(ofSize: 12); foot.textColor = .secondaryLabelColor; foot.frame = NSRect(x: 24, y: 31, width: 530, height: 42); view.addSubview(foot)
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    @objc func openSlot(_ sender: NSButton) {
        let slot = sender.tag
        if let existing = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID(slot)).first { existing.activate(options: [.activateAllWindows]); status.stringValue = "Viber \(slot) 已在运行。"; return }
        buttons.forEach { $0.isEnabled = false }; status.stringValue = "正在准备 Viber \(slot)，首次创建需要复制并签名，请稍候……"
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let target = try prepare(slot)
                _ = try run("/usr/bin/open", ["-n", target.path])
                DispatchQueue.main.async { self.status.stringValue = "已请求打开 Viber \(slot)。请检查窗口；扫码和聊天功能仍需实测。"; self.buttons.forEach { $0.isEnabled = true } }
            } catch {
                DispatchQueue.main.async { self.status.stringValue = "打开失败：\(error.localizedDescription)"; self.buttons.forEach { $0.isEnabled = true } }
            }
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
if CommandLine.arguments.contains("--self-test") {
    precondition((1...5).map(bundleID).count == Set((1...5).map(bundleID)).count)
    precondition((try? supportRoot().lastPathComponent) == "HaituoViberPreview")
    print("SELF_TEST_OK distinct ids and isolated support path")
} else if CommandLine.arguments.contains("--smoke-viber") {
    do {
        for slot in 1...5 { let target = try prepare(slot); _ = try run("/usr/bin/open", ["-n", target.path]); Thread.sleep(forTimeInterval: 5) }
        Thread.sleep(forTimeInterval: 8)
        for slot in 1...5 {
            let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID(slot))
            guard !running.isEmpty else { throw NSError(domain: "HaituoPreview", code: 11, userInfo: [NSLocalizedDescriptionKey: "实例 \(slot) 未运行"]) }
            print("SMOKE_SLOT_\(slot)_RUNNING=\(running.count)")
        }
        print("SMOKE_OK five unlinked processes; login and isolation untested")
    } catch { fputs("SMOKE_FAILED \(error.localizedDescription)\n", stderr); exit(1) }
} else {
    let app = NSApplication.shared
    let delegate = Delegate(); app.delegate = delegate; app.setActivationPolicy(.regular); app.run()
}
