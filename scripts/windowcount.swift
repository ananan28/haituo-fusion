import CoreGraphics
import Foundation

// Prints "<pid> <windowCount>" for on-screen, normal-layer windows.
let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let list = (CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]]) ?? []
var byPid: [Int: Int] = [:]
for w in list {
    guard let pid = w[kCGWindowOwnerPID as String] as? Int,
          let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
          let b = w[kCGWindowBounds as String] as? [String: Any] else { continue }
    let width = (b["Width"] as? Double) ?? 0
    let height = (b["Height"] as? Double) ?? 0
    if width > 40 && height > 40 { byPid[pid, default: 0] += 1 }
}
for (pid, count) in byPid.sorted(by: { $0.key < $1.key }) {
    print("\(pid) \(count)")
}
