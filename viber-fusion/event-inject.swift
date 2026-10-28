import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
_ = NSApplication.shared
guard CommandLine.arguments.count == 2, let pid=Int32(CommandLine.arguments[1]), AXIsProcessTrusted() else { fputs("AX_PERMISSION_OR_PID_MISSING\n",stderr); exit(2) }
guard let windows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]], let target=windows.first(where:{ ($0[kCGWindowOwnerPID as String] as? Int32) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }), let bounds=target[kCGWindowBounds as String] as? [String:CGFloat], let x=bounds["X"],let y=bounds["Y"],let w=bounds["Width"],let h=bounds["Height"] else { fputs("WINDOW_MISSING\n",stderr); exit(3) }
let point=CGPoint(x:x+w/2,y:y+h/2)
var stack=[AXUIElementCreateApplication(pid)]
var hit=false
while let element=stack.popLast(), !hit {
    var raw: CFTypeRef?
    if AXUIElementCopyAttributeValue(element,kAXTitleAttribute as CFString,&raw) == .success, (raw as? String) == "Probe Button" {
        let result=AXUIElementPerformAction(element,kAXPressAction as CFString)
        guard result == .success else { fputs("AX_PRESS_FAILED \(result.rawValue)\n",stderr); exit(6) }
        hit=true; break
    }
    var children: CFTypeRef?
    if AXUIElementCopyAttributeValue(element,kAXChildrenAttribute as CFString,&children) == .success, let list=children as? [AXUIElement] { stack.append(contentsOf:list) }
}
guard hit else { fputs("AX_BUTTON_MISSING\n",stderr); exit(7) }
print("AX_PRESS_SENT")
for type in [CGEventType.leftMouseDown,.leftMouseUp] {
    guard let event=CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:point,mouseButton:.left) else { exit(4) }
    event.postToPid(pid)
    usleep(100000)
}
if let down=CGEvent(keyboardEventSource:nil,virtualKey:0,keyDown:true),let up=CGEvent(keyboardEventSource:nil,virtualKey:0,keyDown:false) { down.postToPid(pid); up.postToPid(pid) } else { exit(5) }
print("EVENTS_POSTED")
