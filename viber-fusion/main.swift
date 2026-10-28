import AppKit
import Foundation
import ScreenCaptureKit
import ApplicationServices
import CoreGraphics
import CoreImage
import CoreMedia

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

final class FusionView: NSView {
    var imageChanged: ((CGImage?) -> Void)?
    var image: CGImage? { didSet { imageChanged?(image) } }
    var target: NSRunningApplication?
    var targetFrame: CGRect = .zero
    var feedback: ((String)->Void)?
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.setFill(); bounds.fill()
        guard let image = image else { return }
        let scale = min(bounds.width / CGFloat(image.width), bounds.height / CGFloat(image.height))
        let rect = CGRect(x:(bounds.width-CGFloat(image.width)*scale)/2, y:(bounds.height-CGFloat(image.height)*scale)/2, width:CGFloat(image.width)*scale, height:CGFloat(image.height)*scale)
        NSImage(cgImage:image,size:NSSize(width:image.width,height:image.height)).draw(in:rect)
    }
    override func mouseDown(with event: NSEvent) {
        guard let image = image, let target = target else { feedback?("当前画面不可操作"); return }
        window?.makeFirstResponder(self)
        let p = convert(event.locationInWindow, from:nil)
        let scale = min(bounds.width / CGFloat(image.width), bounds.height / CGFloat(image.height))
        let r = CGRect(x:(bounds.width-CGFloat(image.width)*scale)/2,y:(bounds.height-CGFloat(image.height)*scale)/2,width:CGFloat(image.width)*scale,height:CGFloat(image.height)*scale)
        guard r.contains(p) else { return }
        let screen = CGPoint(x:targetFrame.minX + (p.x-r.minX)/r.width*targetFrame.width, y:targetFrame.minY + (p.y-r.minY)/r.height*targetFrame.height)
        forwardMouse(screen,target:target)
    }
    func forwardMouse(_ screen: CGPoint, target: NSRunningApplication) {
        var stack=[AXUIElementCreateApplication(target.processIdentifier)], candidates: [(AXUIElement,CGFloat)] = []
        var visited=0
        while let element=stack.popLast(), visited<1500 {
            visited += 1
            var actions: CFArray?, position: CFTypeRef?, sizeRef: CFTypeRef?
            if AXUIElementCopyActionNames(element,&actions) == .success, let names=actions as? [String], names.contains(kAXPressAction as String),
               AXUIElementCopyAttributeValue(element,kAXPositionAttribute as CFString,&position) == .success,
               AXUIElementCopyAttributeValue(element,kAXSizeAttribute as CFString,&sizeRef) == .success,
               let pos=position, let siz=sizeRef, CFGetTypeID(pos)==AXValueGetTypeID(), CFGetTypeID(siz)==AXValueGetTypeID() {
                var origin=CGPoint.zero, dimensions=CGSize.zero
                if AXValueGetValue(pos as! AXValue,.cgPoint,&origin), AXValueGetValue(siz as! AXValue,.cgSize,&dimensions), CGRect(origin:origin,size:dimensions).contains(screen) { candidates.append((element,dimensions.width*dimensions.height)) }
            }
            var children: CFTypeRef?
            if AXUIElementCopyAttributeValue(element,kAXChildrenAttribute as CFString,&children) == .success, let nodes=children as? [AXUIElement] { stack.append(contentsOf:nodes) }
        }
        guard let hit=candidates.sorted(by:{$0.1 < $1.1}).first else { feedback?("此区域尚不支持点击；请在官方窗口操作"); return }
        let result=AXUIElementPerformAction(hit.0,kAXPressAction as CFString)
        if result != .success { feedback?("点击转发失败：\(result.rawValue)") } else { feedback?("点击已发送") }
    }
    override func keyDown(with event: NSEvent) {
        guard !event.modifierFlags.contains(.command), let target=target, let cg=event.cgEvent else { super.keyDown(with:event); return }
        cg.postToPid(target.processIdentifier)
    }
    override func keyUp(with event: NSEvent) {
        guard !event.modifierFlags.contains(.command), let target=target, let cg=event.cgEvent else { super.keyUp(with:event); return }
        cg.postToPid(target.processIdentifier)
    }
}
final class FrameSink: NSObject, SCStreamOutput {
    let context=CIContext(options:nil)
    weak var view: FusionView?
    var onFrame: (() -> Void)?
    var isCurrent: (() -> Bool)?
    init(_ view:FusionView) { self.view=view }
    func stream(_ stream:SCStream,didOutputSampleBuffer sampleBuffer:CMSampleBuffer,of type:SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid, let buffer=CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let input=CIImage(cvPixelBuffer:buffer)
        guard let image=context.createCGImage(input,from:input.extent) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.deliver(image)
        }
    }
    // Main-thread delivery is also exercised with synthetic images by the regression runner.
    func deliver(_ image: CGImage) {
        precondition(Thread.isMainThread)
        guard isCurrent?() == true else { return }
        view?.image=image; view?.needsDisplay=true
        onFrame?()
    }
    func cancel() { isCurrent=nil; onFrame=nil }
}
func largestAXWindow(_ application: AXUIElement) -> AXUIElement? {
    var raw:CFTypeRef?
    guard AXUIElementCopyAttributeValue(application,kAXWindowsAttribute as CFString,&raw) == .success, let windows=raw as? [AXUIElement] else { return nil }
    var selected: AXUIElement?, best: CGFloat = 0
    for candidate in windows {
        var value:CFTypeRef?, size=CGSize.zero
        guard AXUIElementCopyAttributeValue(candidate,kAXSizeAttribute as CFString,&value) == .success, let rawSize=value, CFGetTypeID(rawSize)==AXValueGetTypeID(), AXValueGetValue(rawSize as! AXValue,.cgSize,&size) else { continue }
        let area=size.width*size.height
        if size.width >= 200 && size.height >= 150 && area > best { selected=candidate; best=area }
    }
    return selected
}
final class Delegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window:NSWindow!
    var viewer:FusionView!
    var status:NSTextField!
    var sink:FrameSink?
    var generation = 0
    var geometryValid = false
    var stream:SCStream?
    var buttons:[NSButton]=[]
    var selected=0
    var pending=false
    var showHost=true
    var hostApplication: NSRunningApplication?
    var externalHostFrame: CGRect?
    func applicationDidFinishLaunching(_ notification:Notification) {
        window=NSWindow(contentRect:NSRect(x:0,y:0,width:1100,height:780),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        window.title="Viber 同窗口融合实验"; window.center(); window.minSize=NSSize(width:700,height:500); window.delegate=self
        let root=window.contentView!
        let header=NSStackView(); header.orientation = .horizontal; header.spacing=6; header.translatesAutoresizingMaskIntoConstraints=false
        for slot in 1...5 { let b=NSButton(title:"Viber \(slot)",target:self,action:#selector(selectSlot(_:))); b.tag=slot; header.addArrangedSubview(b); buttons.append(b) }
        root.addSubview(header)
        status=NSTextField(labelWithString:"选择账号。需要屏幕录制及辅助功能权限；聊天内容不会保存到此原型。")
        status.lineBreakMode = .byTruncatingTail; status.translatesAutoresizingMaskIntoConstraints=false; root.addSubview(status)
        viewer=FusionView(); viewer.setAccessibilityElement(true); viewer.setAccessibilityRole(.group); viewer.setAccessibilityLabel("Fusion viewport"); viewer.translatesAutoresizingMaskIntoConstraints=false; root.addSubview(viewer)
        viewer.feedback={ [weak self] message in self?.status.stringValue=message }
        NSLayoutConstraint.activate([header.leadingAnchor.constraint(equalTo:root.leadingAnchor,constant:12),header.topAnchor.constraint(equalTo:root.topAnchor,constant:10),header.heightAnchor.constraint(equalToConstant:32),status.leadingAnchor.constraint(equalTo:root.leadingAnchor,constant:12),status.topAnchor.constraint(equalTo:header.bottomAnchor,constant:5),status.trailingAnchor.constraint(equalTo:root.trailingAnchor,constant:-12),viewer.leadingAnchor.constraint(equalTo:root.leadingAnchor),viewer.trailingAnchor.constraint(equalTo:root.trailingAnchor),viewer.topAnchor.constraint(equalTo:status.bottomAnchor,constant:8),viewer.bottomAnchor.constraint(equalTo:root.bottomAnchor)])
        if showHost { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true) }
    }
    @objc func selectSlot(_ sender:NSButton) {
        guard !pending else { return }
        let slot=sender.tag; pending=true; buttons.forEach{$0.isEnabled=false}
        invalidateConnection()
        let selectionToken=generation
        status.stringValue="正在启动账号 \(slot)……首次准备可能需要几分钟。"
        if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess(); pending=false; buttons.forEach{$0.isEnabled=true}; status.stringValue="请允许屏幕录制，然后重启并重试。"; return }
        if !AXIsProcessTrusted() { let options=[kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String:true] as CFDictionary; _ = AXIsProcessTrustedWithOptions(options); pending=false; buttons.forEach{$0.isEnabled=true}; status.stringValue="请允许辅助功能权限，然后重试。"; return }
        window.title="Fusion: Loading slot \(slot)"
        if !NSRunningApplication.runningApplications(withBundleIdentifier:bundleID(slot)).isEmpty { connect(slot); return }
        DispatchQueue.global(qos:.userInitiated).async { [weak self] in
            do {
                let target=try prepare(slot)
                if NSRunningApplication.runningApplications(withBundleIdentifier:bundleID(slot)).isEmpty { _ = try run("/usr/bin/open",["-n",target.path]) }
                for _ in 0..<40 { if !NSRunningApplication.runningApplications(withBundleIdentifier:bundleID(slot)).isEmpty { break }; Thread.sleep(forTimeInterval:0.5) }
                DispatchQueue.main.async { guard let self=self, self.generation==selectionToken else { return }; self.connect(slot) }
            } catch { DispatchQueue.main.async { guard let self=self, self.generation==selectionToken else { return }; self.done("启动失败：\(error.localizedDescription)") } }
        }
    }
    func done(_ text:String) { pending=false; buttons.forEach{$0.isEnabled=true}; status.stringValue=text }
    // Detach synchronously. Completion of an old stop must never touch the new stream.
    func invalidateConnection(_ message: String? = nil) {
        generation += 1; geometryValid=false; selected=0
        viewer.target=nil; viewer.targetFrame = .zero; viewer.image=nil; viewer.needsDisplay=true
        sink?.cancel(); sink=nil
        let old=stream; stream=nil
        if let message=message {
            window.title="Fusion: Alignment failed"
            status.stringValue=message
        } else { window.title="Fusion: Disconnected" }
        if let old=old { stopDetached { try await old.stopCapture() } }
    }
    @discardableResult
    func stopDetached(_ stop: @escaping () async throws -> Void) -> Task<Void, Never> {
        Task { @MainActor in try? await stop() }
    }
    func geometryFailed(_ message: String, source: AXUIElement?, application: AXUIElement?) {
        if let source=source {
            _=AXUIElementSetAttributeValue(source,kAXMinimizedAttribute as CFString,kCFBooleanTrue)
        } else if let application=application {
            // Even when no main window passes the size filter, minimize any available source windows.
            var raw: CFTypeRef?
            if AXUIElementCopyAttributeValue(application,kAXWindowsAttribute as CFString,&raw) == .success,
               let windows=raw as? [AXUIElement] {
                for window in windows { _=AXUIElementSetAttributeValue(window,kAXMinimizedAttribute as CFString,kCFBooleanTrue) }
            }
        }
        invalidateConnection(message)
    }
    func isCurrent(_ token: Int, _ slot: Int) -> Bool {
        generation == token && selected == slot && geometryValid
    }
    func installCallbacks(_ frameSink: FrameSink, token: Int, slot: Int) {
        frameSink.isCurrent={ [weak self] in self?.isCurrent(token,slot) == true }
        frameSink.onFrame={ [weak self, weak frameSink] in
            guard let self=self, self.isCurrent(token,slot) else { return }
            self.window.title="Fusion: Ready slot \(slot)"
            frameSink?.onFrame=nil
        }
    }
    func connect(_ slot:Int) {
        let token=generation
        guard let app=NSRunningApplication.runningApplications(withBundleIdentifier:bundleID(slot)).first else { done("账号未启动"); return }
        geometryValid=false
        // Normally selection already detached this; direct reconnects use the same ownership rule.
        let old=stream; stream=nil; sink?.cancel(); sink=nil
        Task { @MainActor in
            var local: SCStream?
            var localSink: FrameSink?
            do {
                if let old=old { try? await old.stopCapture(); guard generation == token else { return } }
                guard generation == token else { return }
                for n in 1...5 {
                    guard let candidate=NSRunningApplication.runningApplications(withBundleIdentifier:bundleID(n)).first else { continue }
                    let element=AXUIElementCreateApplication(candidate.processIdentifier)
                    if let item=largestAXWindow(element) {
                        let result=AXUIElementSetAttributeValue(item,kAXMinimizedAttribute as CFString,(n == slot ? kCFBooleanFalse : kCFBooleanTrue))
                        guard result == .success else { throw NSError(domain:"fusion",code:Int(result.rawValue),userInfo:[NSLocalizedDescriptionKey:"窗口切换失败，辅助功能权限或窗口状态异常"]) }
                    }
                }
                try await Task.sleep(nanoseconds:600_000_000)
                guard generation == token else { return }
                let content=try await SCShareableContent.excludingDesktopWindows(false,onScreenWindowsOnly:true)
                guard generation == token else { return }
                guard let target=content.windows.first(where:{$0.owningApplication?.processID == app.processIdentifier && $0.frame.width > 100 && $0.frame.height > 100}) else { throw NSError(domain:"fusion",code:1,userInfo:[NSLocalizedDescriptionKey:"没有找到 Viber 窗口"]) }
                let config=SCStreamConfiguration(); config.width=Int(target.frame.width); config.height=Int(target.frame.height); config.minimumFrameInterval=CMTime(value:1,timescale:10); config.queueDepth=3; config.showsCursor=false
                let next=SCStream(filter:SCContentFilter(desktopIndependentWindow:target),configuration:config,delegate:nil)
                local=next
                let frameSink=FrameSink(viewer); localSink=frameSink
                installCallbacks(frameSink,token:token,slot:slot)
                sink=frameSink
                try next.addStreamOutput(frameSink,type:.screen,sampleHandlerQueue:DispatchQueue(label:"haituo.viber.frames"))
                selected=slot
                try await next.startCapture()
                guard generation == token else { frameSink.cancel(); try? await next.stopCapture(); return }
                stream=next; local=nil; viewer.target=app; viewer.targetFrame=target.frame
                if showHost { window.makeKeyAndOrderFront(nil); window.makeFirstResponder(viewer); NSApp.activate(ignoringOtherApps:true) }
                // Alignment owns validity. Frames arriving before validation keep the first-frame callback.
                alignSourceWindow(whileConnecting:true)
                if !showHost, let host=hostApplication, NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier {
                    _=host.activate(options:[.activateIgnoringOtherApps])
                }
                guard generation == token else {
                    // Invalidation detached and stopped the stream already; only finish our pending request.
                    pending=false; buttons.forEach{$0.isEnabled=true}; return
                }
                done("账号 \(slot) 画面已连接；仅支持可访问控件点击，输入与滚动尚未完整验证。")
            } catch {
                let failed=local; localSink?.cancel()
                if generation == token {
                    invalidateConnection()
                    done("连接失败：\(error.localizedDescription)")
                }
                // Stop only the local unpublished stream; never clear state after this await.
                if let failed=failed { try? await failed.stopCapture() }
            }
        }
    }
    func windowDidMove(_ notification:Notification) { alignSourceWindow() }
    func windowDidResize(_ notification:Notification) { alignSourceWindow() }
    func alignSourceWindow(whileConnecting: Bool = false) {
        guard (!pending || whileConnecting), selected > 0, let app=viewer.target, let window=window else { return }
        geometryValid=false
        let application=AXUIElementCreateApplication(app.processIdentifier)
        let source=largestAXWindow(application)
        func fail(_ message: String) {
            geometryFailed(message,source:source,application:application)
        }
        let host: CGRect?
        if let external=externalHostFrame { host=external }
        else if let rows=CGWindowListCopyWindowInfo([.optionIncludingWindow],CGWindowID(window.windowNumber)) as? [[String:Any]],
                let row=rows.first,let bounds=row[kCGWindowBounds as String] as? [String:Any],
                let x=(bounds["X"] as? NSNumber)?.doubleValue,let y=(bounds["Y"] as? NSNumber)?.doubleValue,
                let width=(bounds["Width"] as? NSNumber)?.doubleValue,let height=(bounds["Height"] as? NSNumber)?.doubleValue {
            host=CGRect(x:x,y:y,width:width,height:height)
        } else { host=nil }
        guard let host=host, !host.isEmpty, !host.isInfinite, !host.isNull else { fail("无法获取宿主窗口几何，已暂停操作。"); return }
        let x=host.minX,y=host.minY,width=host.width,height=host.height
        guard let source=source else { fail("无法识别 Viber 主窗口，已暂停操作。"); return }
        var desiredSize=CGSize(width:max(1,width-20),height:max(1,height-90))
        var desiredPosition=CGPoint(x:x+10,y:y+80)
        guard let size=AXValueCreate(.cgSize,&desiredSize),let pos=AXValueCreate(.cgPoint,&desiredPosition) else { fail("无法创建窗口几何，已暂停操作。"); return }
        let sizeResult=AXUIElementSetAttributeValue(source,kAXSizeAttribute as CFString,size)
        let positionResult=AXUIElementSetAttributeValue(source,kAXPositionAttribute as CFString,pos)
        var actualPos:CFTypeRef?,actualSize:CFTypeRef?,p=CGPoint.zero,z=CGSize.zero
        let readPos=AXUIElementCopyAttributeValue(source,kAXPositionAttribute as CFString,&actualPos)
        let readSize=AXUIElementCopyAttributeValue(source,kAXSizeAttribute as CFString,&actualSize)
        var decoded=false
        if let ap=actualPos,let az=actualSize,CFGetTypeID(ap)==AXValueGetTypeID(),CFGetTypeID(az)==AXValueGetTypeID() {
            decoded=AXValueGetValue(ap as! AXValue,.cgPoint,&p) && AXValueGetValue(az as! AXValue,.cgSize,&z)
        }
        if decoded, z.width > 0, z.height > 0, p.x.isFinite, p.y.isFinite, z.width.isFinite, z.height.isFinite,
           sizeResult == .success, positionResult == .success, readPos == .success, readSize == .success,
           CGRect(x:x,y:y,width:width,height:height).insetBy(dx:-1,dy:-1).contains(CGRect(origin:p,size:z)) {
            viewer.targetFrame=CGRect(origin:p,size:z); geometryValid=true
        } else {
            fail("无法安全对齐 Viber 窗口：size=\(sizeResult.rawValue) position=\(positionResult.rawValue) host=\(Int(width))x\(Int(height)) actual=\(Int(z.width))x\(Int(z.height))@\(Int(p.x)),\(Int(p.y))；已暂停操作。")
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool { true }
}
#if !STATE_REGRESSION && !FUSION_BRIDGE
let app=NSApplication.shared
let delegate=Delegate(); app.delegate=delegate; app.setActivationPolicy(.regular); app.run()

#endif
