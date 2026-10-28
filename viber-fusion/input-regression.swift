// Actions-only generated AppKit field: verify real AX text insertion without a Viber account.
let inputApp=NSApplication.shared
inputApp.setActivationPolicy(.regular)
let inputWindow=NSWindow(contentRect:NSRect(x:80,y:80,width:600,height:300),styleMask:[.titled],backing:.buffered,defer:false)
let inputField=NSTextField(frame:NSRect(x:30,y:100,width:500,height:50))
inputField.isEditable=true;inputField.isSelectable=true
inputWindow.contentView!.addSubview(inputField);inputWindow.makeKeyAndOrderFront(nil);inputWindow.makeFirstResponder(inputField)
inputApp.activate(ignoringOtherApps:true)
DispatchQueue.main.asyncAfter(deadline:.now()+0.5) {
    guard AXIsProcessTrusted() else { fatalError("INPUT_REGRESSION_BLOCKED_AX_PERMISSION") }
    let view=FusionView();view.target=NSRunningApplication.current
    var feedback="";view.feedback={feedback=$0}
    let inserted=view.insertFocusedText("Synthetic typed message")
    inputWindow.makeFirstResponder(nil)
    guard inserted,inputField.stringValue=="Synthetic typed message",feedback.contains("尚未发送") else {fatalError("INPUT_REGRESSION_INSERT_FAILED: \(feedback)")}
    guard !view.insertFocusedText("") else {fatalError("INPUT_REGRESSION_ACCEPTED_EMPTY_TEXT")}
    view.target=nil
    guard !view.insertFocusedText("Wrong target"),inputField.stringValue=="Synthetic typed message" else {fatalError("INPUT_REGRESSION_WRONG_TARGET")}
    print("INPUT_REGRESSION_PASS: focused owned AppKit field, exact text, empty/invalid target rejected, no send event")
    inputApp.terminate(nil)
}
inputApp.run()
