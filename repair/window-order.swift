import Foundation
import CoreGraphics
import AppKit
if let index=CommandLine.arguments.firstIndex(of:"--activate"),CommandLine.arguments.count>index+1,let pid=Int32(CommandLine.arguments[index+1]),let target=NSRunningApplication(processIdentifier:pid){
    target.activate(options:[.activateAllWindows,.activateIgnoringOtherApps]);exit(0)
}
if CommandLine.arguments.contains("--foreground-window") {
    let app=NSApplication.shared
    app.setActivationPolicy(.regular)
    let window=NSWindow(contentRect:NSRect(x:140,y:140,width:900,height:650),styleMask:[.titled,.closable],backing:.buffered,defer:false)
    window.title="External foreground verification"
    window.makeKeyAndOrderFront(nil)
    app.activate(ignoringOtherApps:true)
    app.run()
    exit(0)
}
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []
let result = windows.map { window -> [String:Any] in
    ["id":window[kCGWindowNumber as String] ?? 0,"pid":window[kCGWindowOwnerPID as String] ?? 0,"layer":window[kCGWindowLayer as String] ?? 0,"bounds":window[kCGWindowBounds as String] ?? [:]]
}
let data = try JSONSerialization.data(withJSONObject:result)
print(String(data:data,encoding:.utf8)!)
