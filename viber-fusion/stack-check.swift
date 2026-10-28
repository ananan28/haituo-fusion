import AppKit
import CoreGraphics
import Foundation
_ = NSApplication.shared
guard CommandLine.arguments.count == 3, let host=Int32(CommandLine.arguments[1]), let target=Int32(CommandLine.arguments[2]) else { exit(2) }
guard let rows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] else { exit(3) }
func owner(_ row:[String:Any])->Int32? { row[kCGWindowOwnerPID as String] as? Int32 }
func layer(_ row:[String:Any])->Int? { row[kCGWindowLayer as String] as? Int }
func rect(_ row:[String:Any])->CGRect? {
    guard let b=row[kCGWindowBounds as String] as? [String:Any],let x=(b["X"] as? NSNumber)?.doubleValue,let y=(b["Y"] as? NSNumber)?.doubleValue,let w=(b["Width"] as? NSNumber)?.doubleValue,let h=(b["Height"] as? NSNumber)?.doubleValue else {return nil}
    return CGRect(x:x,y:y,width:w,height:h)
}
guard let hi=rows.firstIndex(where:{owner($0)==host && layer($0)==0}),let hostRect=rect(rows[hi]) else {fputs("HOST_WINDOW_UNAVAILABLE\n",stderr);exit(4)}
var displays=[CGDirectDisplayID](repeating:0,count:16)
var displayCount:UInt32=0
guard CGGetActiveDisplayList(16,&displays,&displayCount) == .success else { exit(7) }
let screens=displays.prefix(Int(displayCount)).map { CGDisplayBounds($0) }
let targets=rows.enumerated().filter{owner($0.element)==target && layer($0.element)==0}
guard !targets.isEmpty else {fputs("TARGET_WINDOW_UNAVAILABLE\n",stderr);exit(5)}
var good=true
for (i,row) in targets {
    guard let targetRect=rect(row) else {good=false;continue}
    for screen in screens {
        let visible=targetRect.intersection(screen)
        if visible.isNull || visible.isEmpty {continue}
        let above=hi<i
        let covered=hostRect.insetBy(dx:-1,dy:-1).contains(visible)
        print("STACK hostAbove=\(above) visibleCovered=\(covered) host=\(hostRect) visible=\(visible)")
        if !above || !covered {good=false}
    }
}
if !good {exit(6)}
