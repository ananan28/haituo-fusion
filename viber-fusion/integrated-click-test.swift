import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
_ = NSApplication.shared
func descendants(_ root:AXUIElement)->[AXUIElement] {
    var stack=[root], result:[AXUIElement]=[]
    while let node=stack.popLast(), result.count<1500 {
        result.append(node); var children:CFTypeRef?
        if AXUIElementCopyAttributeValue(node,kAXChildrenAttribute as CFString,&children) == .success,let list=children as? [AXUIElement] { stack.append(contentsOf:list) }
    }
    return result
}
func stringAttr(_ e:AXUIElement,_ attr:String)->String? { var value:CFTypeRef?; guard AXUIElementCopyAttributeValue(e,attr as CFString,&value) == .success else {return nil}; return value as? String }
func bounds(_ e:AXUIElement)->CGRect? {
    var p:CFTypeRef?,s:CFTypeRef?,point=CGPoint.zero,size=CGSize.zero
    guard AXUIElementCopyAttributeValue(e,kAXPositionAttribute as CFString,&p) == .success,AXUIElementCopyAttributeValue(e,kAXSizeAttribute as CFString,&s) == .success,let p=p,let s=s,CFGetTypeID(p)==AXValueGetTypeID(),CFGetTypeID(s)==AXValueGetTypeID(),AXValueGetValue(p as! AXValue,.cgPoint,&point),AXValueGetValue(s as! AXValue,.cgSize,&size) else {return nil}
    return CGRect(origin:point,size:size)
}
guard CommandLine.arguments.count==3,let hostPID=Int32(CommandLine.arguments[1]),let targetPID=Int32(CommandLine.arguments[2]),AXIsProcessTrusted() else { fputs("AX_PERMISSION_OR_PID_MISSING\n",stderr);exit(1) }
let hostNodes=descendants(AXUIElementCreateApplication(hostPID))
guard let viewport=hostNodes.first(where:{stringAttr($0,kAXDescriptionAttribute) == "Fusion viewport"}),let hostRect=bounds(viewport) else {fputs("VIEWPORT_NOT_ACCESSIBLE\n",stderr);exit(2)}
let targetNodes=descendants(AXUIElementCreateApplication(targetPID))
guard let targetWindow=targetNodes.first(where:{stringAttr($0,kAXRoleAttribute) == kAXWindowRole as String}),let targetRect=bounds(targetWindow) else {fputs("TARGET_WINDOW_NOT_ACCESSIBLE\n",stderr);exit(3)}
var candidate:CGRect?
for node in targetNodes {
    guard stringAttr(node,kAXRoleAttribute) == kAXButtonRole as String,let rect=bounds(node),rect.width>=50,rect.height>=20,rect.minY>=targetRect.minY+60 else {continue}
    var actions:CFArray?
    if AXUIElementCopyActionNames(node,&actions) == .success,let names=actions as? [String],names.contains(kAXPressAction as String) { candidate=rect;break }
}
guard let button=candidate else {fputs("TARGET_BODY_BUTTON_NOT_FOUND\n",stderr);exit(4)}
let scale=min(hostRect.width/targetRect.width,hostRect.height/targetRect.height)
let frame=CGRect(x:hostRect.minX+(hostRect.width-targetRect.width*scale)/2,y:hostRect.minY+(hostRect.height-targetRect.height*scale)/2,width:targetRect.width*scale,height:targetRect.height*scale)
let point=CGPoint(x:frame.minX+(button.midX-targetRect.minX)/targetRect.width*frame.width,y:frame.minY+(button.midY-targetRect.minY)/targetRect.height*frame.height)
for type in [CGEventType.mouseMoved,.leftMouseDown,.leftMouseUp] {guard let event=CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:point,mouseButton:.left) else {exit(5)};event.post(tap:.cghidEventTap);usleep(100000)}
print("SENT_HOST_MOUSE_EVENT")
