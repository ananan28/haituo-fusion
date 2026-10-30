import AppKit
import CoreGraphics
import ScreenCaptureKit
import ImageIO
import UniformTypeIdentifiers

@main
struct HaituoScreenCapture {
    @MainActor static func main() async {
        NSApplication.shared.setActivationPolicy(.prohibited)
        let args = CommandLine.arguments
        func reply(_ value: [String: Any], _ code: Int32 = 0) -> Never {
            if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), let text = String(data: data, encoding: .utf8) { print(text) }
            exit(code)
        }
        if args.count == 2 && args[1] == "--probe" {
            reply(["permission": CGPreflightScreenCaptureAccess() ? "granted" : "not-granted"])
        }
        guard args.count == 5, let displayID = UInt32(args[1]), let width = Int(args[2]), let height = Int(args[3]), width > 0, height > 0, width <= 16384, height <= 16384, width * height <= 40_000_000, args[4].hasPrefix("/") else {
            reply(["ok": false, "code": "INVALID_CAPTURE_REQUEST"], 2)
        }
        // Only invoked following an explicit screenshot action. Never bypass TCC.
        guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
            reply(["ok": false, "code": "SCREEN_PERMISSION_REQUIRED"], 3)
        }
        do {
            let image: CGImage
            if #available(macOS 14.0, *) {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
                    reply(["ok": false, "code": "DISPLAY_NOT_FOUND"], 4)
                }
                let filter = SCContentFilter(display: display, excludingWindows: [])
                let config = SCStreamConfiguration()
                config.width = width
                config.height = height
                config.showsCursor = false
                image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            } else {
                guard let legacy = CGDisplayCreateImage(displayID) else {
                    reply(["ok": false, "code": "SCREEN_CAPTURE_FAILED"], 5)
                }
                image = legacy
            }
            let file = URL(fileURLWithPath: args[4])
            guard let writer = CGImageDestinationCreateWithURL(file as CFURL, UTType.png.identifier as CFString, 1, nil) else {
                reply(["ok": false, "code": "CAPTURE_WRITE_FAILED"], 6)
            }
            CGImageDestinationAddImage(writer, image, nil)
            guard CGImageDestinationFinalize(writer) else {
                reply(["ok": false, "code": "CAPTURE_WRITE_FAILED"], 6)
            }
            reply(["ok": true, "displayId": displayID, "width": image.width, "height": image.height])
        } catch {
            reply(["ok": false, "code": CGPreflightScreenCaptureAccess() ? "SCREEN_CAPTURE_FAILED" : "SCREEN_PERMISSION_REQUIRED"], 7)
        }
    }
}
