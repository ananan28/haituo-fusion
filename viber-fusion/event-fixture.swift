import AppKit
import Foundation

let role = CommandLine.arguments[1]
let output = CommandLine.arguments[2]
class TestView: NSView {
    var destination: String = ""
    override var acceptsFirstResponder: Bool { true }
    override func mouseDown(with event: NSEvent) { try? "MOUSE_OK\n".write(toFile: destination + ".mouse", atomically: true, encoding: .utf8) }
    override func keyDown(with event: NSEvent) { try? "KEY_OK\n".write(toFile: destination + ".key", atomically: true, encoding: .utf8) }
    override func draw(_ dirtyRect: NSRect) { NSColor.controlBackgroundColor.setFill(); dirtyRect.fill() }
}
class TestDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    @objc func pressed(_ sender: Any?) { try? "MOUSE_OK\n".write(toFile: output + ".mouse", atomically: true, encoding: .utf8) }
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 150, y: 150, width: 500, height: 320), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = role
        let view=TestView(frame: window.contentView!.bounds); view.destination=output; window.contentView=view
        let button=NSButton(title: "Probe Button", target: self, action: #selector(pressed(_:))); button.frame=NSRect(x: 175, y: 120, width: 150, height: 80); view.addSubview(button)
        window.makeKeyAndOrderFront(nil); window.makeFirstResponder(view); NSApp.activate(ignoringOtherApps: true)
        try? "READY".write(toFile: output + ".ready", atomically: true, encoding: .utf8)
    }
}
let application=NSApplication.shared
let delegate=TestDelegate(); application.delegate=delegate; application.setActivationPolicy(.regular); application.run()
