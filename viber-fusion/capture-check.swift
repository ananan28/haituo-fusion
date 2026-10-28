import AppKit
import ApplicationServices
import ScreenCaptureKit
import CoreGraphics
import CoreMedia
import Foundation

final class FrameCounter: NSObject, SCStreamOutput {
    private let lock = NSLock()
    private var value = 0
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen && sampleBuffer.isValid else { return }
        lock.lock(); value += 1; lock.unlock()
    }
    func count() -> Int { lock.lock(); defer { lock.unlock() }; return value }
}
@main struct CaptureProbe {
    @MainActor static func main() async {
        _ = NSApplication.shared
        let identifier = "com.haituo.viberpreview.slot5"
        guard CGPreflightScreenCaptureAccess() else {
            fputs("SCREEN_CAPTURE_UNTRUSTED: screen recording permission missing\n", stderr); exit(10)
        }
        guard let process = NSRunningApplication.runningApplications(withBundleIdentifier: identifier).first else {
            fputs("VIBER_PROCESS_MISSING\n", stderr); exit(11)
        }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let window = content.windows.first(where: { $0.owningApplication?.processID == process.processIdentifier && $0.frame.width > 100 && $0.frame.height > 100 }) else {
                fputs("VIBER_WINDOW_UNAVAILABLE\n", stderr); exit(12)
            }
            let config = SCStreamConfiguration()
            config.width = max(1, Int(window.frame.width))
            config.height = max(1, Int(window.frame.height))
            config.showsCursor = false
            let filter = SCContentFilter(desktopIndependentWindow: window)
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            guard image.width > 100 && image.height > 100 else { fputs("EMPTY_IMAGE_DIMENSIONS\n", stderr); exit(13) }
            print("CAPTURE_OK width=\(image.width) height=\(image.height) window=\(window.windowID)")
            config.minimumFrameInterval = CMTime(value: 1, timescale: 10)
            config.queueDepth = 3
            let stream = SCStream(filter: filter, configuration: config, delegate: nil)
            let frames = FrameCounter()
            try stream.addStreamOutput(frames, type: .screen, sampleHandlerQueue: DispatchQueue(label: "viber.test.frames"))
            try await stream.startCapture()
            try await Task.sleep(nanoseconds: 4_000_000_000)
            try await stream.stopCapture()
            let frameCount = frames.count()
            print("STREAM_FRAME_COUNT=\(frameCount)")
            guard frameCount >= 2 else { fputs("STREAM_NOT_ENOUGH_FRAMES\\n", stderr); exit(15) }
            if AXIsProcessTrusted() {
                let application = AXUIElementCreateApplication(process.processIdentifier)
                var rawWindows: CFTypeRef?
                let windowStatus = AXUIElementCopyAttributeValue(application, kAXWindowsAttribute as CFString, &rawWindows)
                let windowElements = rawWindows as? [AXUIElement] ?? []
                print("AX_WINDOW_QUERY status=\(windowStatus.rawValue) count=\(windowElements.count)")
                var stack = windowElements
                var count = 0, pressable = 0
                var bodyPressTarget: AXUIElement?
                var roles: [String: Int] = [:]
                while let element = stack.popLast(), count < 1000 {
                    count += 1
                    var role: CFTypeRef?
                    if AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role) == .success, let name = role as? String { roles[name, default: 0] += 1 }
                    var actions: CFArray?
                    if AXUIElementCopyActionNames(element, &actions) == .success, let names = actions as? [String], names.contains(kAXPressAction as String) {
                        pressable += 1
                        var posRaw: CFTypeRef?, sizeRaw: CFTypeRef?
                        var pos = CGPoint.zero, size = CGSize.zero
                        if AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRaw) == .success,
                           AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRaw) == .success,
                           let p = posRaw, let z = sizeRaw, CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(z) == AXValueGetTypeID() {
                            _ = AXValueGetValue(p as! AXValue, .cgPoint, &pos)
                            _ = AXValueGetValue(z as! AXValue, .cgSize, &size)
                            print("PRESSABLE_GEOMETRY x=\(Int(pos.x)) y=\(Int(pos.y)) w=\(Int(size.width)) h=\(Int(size.height))")
                            if bodyPressTarget == nil && size.width >= 50 && size.height >= 20 && pos.y >= window.frame.minY + 60 { bodyPressTarget = element }
                        }
                    }
                    var children: CFTypeRef?
                    if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success, let found = children as? [AXUIElement] { stack.append(contentsOf: found) }
                }
                print("ACCESSIBILITY_COUNTS total=\(count) pressable=\(pressable) roles=\(roles)")
                guard let bodyButton = bodyPressTarget else { fputs("NO_ACTIONABLE_BODY_BUTTON\n",stderr); exit(16) }
                let pressed = AXUIElementPerformAction(bodyButton, kAXPressAction as CFString)
                print("VIBER_BODY_AX_PRESS status=\(pressed.rawValue)")
                guard pressed == .success else { exit(17) }
            } else { print("ACCESSIBILITY_UNTESTED") }
            print("UNTESTED: live embedding, mouse, keyboard, focus, account login and privacy isolation")
        } catch {
            fputs("CAPTURE_FAILURE \(error.localizedDescription)\n", stderr); exit(14)
        }
    }
}
