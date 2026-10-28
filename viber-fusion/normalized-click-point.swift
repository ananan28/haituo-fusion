import AppKit
import ApplicationServices
import Foundation
_ = NSApplication.shared
guard CommandLine.arguments.count==2,let pid=Int32(CommandLine.arguments[1]),AXIsProcessTrusted() else {exit(1)}
func string(_ element:AXUIElement,_ name:String)->String? {var raw:CFTypeRef?;guard AXUIElementCopyAttributeValue(element,name as CFString,&raw) == .success else{return nil};return raw as? String}
func rect(_ element:AXUIElement)->CGRect? {
    var rawPoint:CFTypeRef?,rawSize:CFTypeRef?,point=CGPoint.zero,size=CGSize.zero
    guard AXUIElementCopyAttributeValue(element,kAXPositionAttribute as CFString,&rawPoint) == .success,
          AXUIElementCopyAttributeValue(element,kAXSizeAttribute as CFString,&rawSize) == .success,
          let p=rawPoint,let s=rawSize,CFGetTypeID(p)==AXValueGetTypeID(),CFGetTypeID(s)==AXValueGetTypeID(),
          AXValueGetValue(p as! AXValue,.cgPoint,&point),AXValueGetValue(s as! AXValue,.cgSize,&size) else{return nil}
    return CGRect(origin:point,size:size)
}
var queue=[AXUIElementCreateApplication(pid)],nodes:[AXUIElement]=[]
while let node=queue.popLast(),nodes.count<1500 {nodes.append(node);var children:CFTypeRef?;if AXUIElementCopyAttributeValue(node,kAXChildrenAttribute as CFString,&children) == .success,let children=children as? [AXUIElement]{queue.append(contentsOf:children)}}
guard let window=nodes.filter({string($0,kAXRoleAttribute)==kAXWindowRole as String}).compactMap({rect($0)}).max(by:{$0.width*$0.height<$1.width*$1.height}) else{exit(2)}
for node in nodes {
    guard string(node,kAXRoleAttribute)==kAXButtonRole as String,let button=rect(node),button.width>=50,button.height>=20,button.minY>=window.minY+60,window.contains(button) else{continue}
    var actions:CFArray?
    if AXUIElementCopyActionNames(node,&actions) == .success,let names=actions as? [String],names.contains(kAXPressAction as String){
        let value=["x":(button.midX-window.minX)/window.width,"y":(button.midY-window.minY)/window.height]
        print(String(data:try! JSONSerialization.data(withJSONObject:value),encoding:.utf8)!);exit(0)
    }
}
exit(3)
