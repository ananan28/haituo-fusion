import SwiftUI
import Foundation
import Combine
import Darwin
import AppKit

struct Account: Identifiable, Codable, Equatable {
    var id: String
    var name: String
    var note: String
    var selected: Bool
    var desired: Bool

    enum CodingKeys: String, CodingKey { case id, name, note, selected, desired, enabled }

    init(id: String, name: String, note: String, selected: Bool = false, desired: Bool = false) {
        self.id = id; self.name = name; self.note = note; self.selected = selected; self.desired = desired
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? "账号"
        note = (try? c.decode(String.self, forKey: .note)) ?? ""
        selected = (try? c.decode(Bool.self, forKey: .selected)) ?? (try? c.decode(Bool.self, forKey: .enabled)) ?? false
        desired = (try? c.decode(Bool.self, forKey: .desired)) ?? false
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(note, forKey: .note)
        try c.encode(selected, forKey: .selected)
        try c.encode(desired, forKey: .desired)
    }

    static func make(index: Int) -> Account {
        Account(id: UUID().uuidString, name: "账号 \(index)", note: "")
    }
}

struct AppState: Codable {
    var version: Int
    var target: Int
    var keepAlive: Bool
    var accounts: [Account]

    enum CodingKeys: String, CodingKey { case version, target, keepAlive, accounts }

    init(version: Int = 2, target: Int = 16, keepAlive: Bool = true, accounts: [Account] = []) {
        self.version = version
        self.target = target
        self.keepAlive = keepAlive
        self.accounts = accounts
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = (try? c.decode(Int.self, forKey: .version)) ?? 1
        target = (try? c.decode(Int.self, forKey: .target)) ?? 16
        keepAlive = (try? c.decode(Bool.self, forKey: .keepAlive)) ?? true
        accounts = (try? c.decode([Account].self, forKey: .accounts)) ?? []
    }
}

final class Store: ObservableObject {
    @Published var accounts: [Account] = []
    @Published var target: Int = 16
    @Published var keepAlive: Bool = true
    @Published var status: [String: Bool] = [:]
    @Published var errorText: String = ""

    let base = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("ViberMulti", isDirectory: true)
    private var watchdog: Timer?
    private var lastLaunch: [String: Date] = [:]
    private var lastSaved: String = ""
    private var bootstrapped = false
    private var autoCount = 0

    init() {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--auto"), i + 1 < args.count, let n = Int(args[i + 1]) {
            autoCount = n
        }
    }

    var viberPath: String {
        let candidates = [
            "/Applications/Viber.app/Contents/MacOS/Viber",
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/Viber.app/Contents/MacOS/Viber").path
        ]
        for c in candidates where FileManager.default.isExecutableFile(atPath: c) { return c }
        return candidates[0]
    }

    var runningCount: Int { accounts.filter { status[$0.id] == true }.count }
    var selectedCount: Int { accounts.filter { $0.selected }.count }

    private var stateFile: URL { base.appendingPathComponent("accounts.json") }

    func bootstrap() {
        guard !bootstrapped else { return }
        bootstrapped = true
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: stateFile),
           let s = try? JSONDecoder().decode(AppState.self, from: data),
           !s.accounts.isEmpty {
            accounts = s.accounts
            target = max(1, min(64, s.target))
            keepAlive = s.keepAlive
        } else {
            target = 16
            keepAlive = true
            accounts = (1...16).map { Account.make(index: $0) }
            save(force: true)
        }
        refreshStatus()
        startWatchdog()
        if autoCount > 0 {
            target = autoCount
            applyCountAndLaunch()
        }
    }

    private func startWatchdog() {
        watchdog?.invalidate()
        let timer = Timer(timeInterval: 3.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.refreshStatus()
            if self.keepAlive { self.reviveDesired() }
            self.save()
        }
        RunLoop.main.add(timer, forMode: .common)
        watchdog = timer
    }

    private func reviveDesired() {
        let now = Date()
        for a in accounts where a.desired && status[a.id] != true {
            if let last = lastLaunch[a.id], now.timeIntervalSince(last) < 10 { continue }
            launch(a, markDesired: false)
        }
    }

    func applyCount() {
        let n = max(1, min(64, target))
        target = n
        if n > accounts.count {
            for i in (accounts.count + 1)...n { accounts.append(Account.make(index: i)) }
        } else if n < accounts.count {
            for a in accounts[n...] where status[a.id] == true { stop(a) }
            accounts.removeSubrange(n...)
        }
        save(force: true)
        refreshStatus()
    }

    func applyCountAndLaunch() {
        applyCount()
        launchAll()
    }

    func add() {
        accounts.append(Account.make(index: accounts.count + 1))
        target = accounts.count
        save(force: true)
        refreshStatus()
    }

    func selectAll() { for i in accounts.indices { accounts[i].selected = true } }
    func deselectAll() { for i in accounts.indices { accounts[i].selected = false } }

    func launchSelected() { for a in accounts where a.selected { launch(a) } }
    func launchAll() { for a in accounts { launch(a) } }

    func stopSelected() { for a in accounts where a.selected { stop(a) } }
    func stopAll() { for a in accounts { stop(a) } }

    func removeSelected() {
        let ids = Set(accounts.filter { $0.selected }.map { $0.id })
        for a in accounts where ids.contains(a.id) { stop(a) }
        accounts.removeAll { ids.contains($0.id) }
        target = max(1, accounts.count)
        save(force: true)
        refreshStatus()
    }

    func removeAll() {
        stopAll()
        accounts.removeAll()
        target = 1
        save(force: true)
        refreshStatus()
    }

    func save(force: Bool = false) {
        let snapshot = AppState(version: 2, target: target, keepAlive: keepAlive, accounts: accounts)
        guard let data = try? JSONEncoder().encode(snapshot),
              let text = String(data: data, encoding: .utf8) else { return }
        guard force || text != lastSaved else { return }
        lastSaved = text
        try? data.write(to: stateFile, options: .atomic)
    }

    func profileDir(_ a: Account) -> URL { base.appendingPathComponent("profiles/\(a.id)", isDirectory: true) }
    func tempDir(_ a: Account) -> URL { base.appendingPathComponent("tmp/\(a.id)", isDirectory: true) }
    private func pidFile(_ a: Account) -> URL { profileDir(a).appendingPathComponent(".pid") }

    func launch(_ a: Account, markDesired: Bool = true) {
        if markDesired, let i = accounts.firstIndex(where: { $0.id == a.id }), !accounts[i].desired {
            accounts[i].desired = true
            save(force: true)
        }
        if let i = accounts.firstIndex(where: { $0.id == a.id }), status[a.id] == true {
            accounts[i].desired = markDesired ? true : accounts[i].desired
            return
        }

        let home = profileDir(a)
        let tmp = tempDir(a)
        do {
            try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        } catch {
            errorText = "创建目录失败: \(error.localizedDescription)"
            return
        }
        guard FileManager.default.isExecutableFile(atPath: viberPath) else {
            errorText = "找不到 Viber: \(viberPath)"
            return
        }
        var env = ProcessInfo.processInfo.environment
        env["HOME"] = home.path
        env["CFFIXED_USER_HOME"] = home.path
        env["TMPDIR"] = tmp.path + "/"

        let p = Process()
        p.executableURL = URL(fileURLWithPath: viberPath)
        p.environment = env
        p.currentDirectoryURL = home
        do {
            try p.run()
            try? "\(p.processIdentifier)".write(to: pidFile(a), atomically: true, encoding: .utf8)
            lastLaunch[a.id] = Date()
            errorText = ""
        } catch {
            errorText = "启动失败: \(error.localizedDescription)"
        }
        refreshStatus()
        save(force: true)
    }

    func stop(_ a: Account) {
        if let i = accounts.firstIndex(where: { $0.id == a.id }) { accounts[i].desired = false }
        let pid = readPid(a)
        if pid > 0 { kill(pid, SIGTERM) }
        try? FileManager.default.removeItem(at: pidFile(a))
        lastLaunch[a.id] = nil
        refreshStatus()
        save(force: true)
    }

    private func readPid(_ a: Account) -> Int32 {
        guard let s = try? String(contentsOf: pidFile(a), encoding: .utf8),
              let v = Int32(s.trimmingCharacters(in: .whitespacesAndNewlines)) else { return 0 }
        return v
    }

    func refreshStatus() {
        var next: [String: Bool] = [:]
        for a in accounts {
            let pid = readPid(a)
            next[a.id] = pid > 0 && kill(pid, 0) == 0
        }
        if next != status { status = next }
    }

    func openDataFolder() {
        NSWorkspace.shared.activateFileViewerSelecting([base])
    }
}

struct ContentView: View {
    @ObservedObject var store: Store

    private var targetBinding: Binding<String> {
        Binding(
            get: { String(store.target) },
            set: { store.target = Int($0.filter { $0.isNumber }) ?? store.target }
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("Viber 多开").font(.title3).bold()
                Text("\(store.runningCount) / \(store.accounts.count) 运行中")
                    .font(.caption).foregroundColor(.secondary)
                Spacer()
                Text(store.viberPath).font(.caption2).foregroundColor(.secondary).lineLimit(1).truncationMode(.middle)
            }
            .padding(.horizontal).padding(.top, 12).padding(.bottom, 8)

            Divider()

            HStack(spacing: 8) {
                Text("数量").font(.caption).foregroundColor(.secondary)
                TextField("16", text: targetBinding).frame(width: 44).multilineTextAlignment(.center)
                Button("按数量启动") { store.applyCountAndLaunch() }
                    .help("生成 N 个账号槽位并全部启动，多余的会先停止再移除")
                Button("仅生成") { store.applyCount() }
                Toggle("自动保持运行", isOn: $store.keepAlive)
                    .help("勾选后，已启动的实例退出会被自动拉起；单独点某行「停止」可退出保持")
                Spacer()
                Button("全选") { store.selectAll() }
                Button("全不选") { store.deselectAll() }
            }
            .padding(.horizontal).padding(.vertical, 8)

            Divider()

            HStack(spacing: 10) {
                Text("选").frame(width: 22)
                Text("账号").frame(width: 120, alignment: .leading)
                Text("备注").frame(maxWidth: .infinity, alignment: .leading)
                Text("状态").frame(width: 44)
                Text("操作").frame(width: 56)
            }
            .font(.caption).foregroundColor(.secondary)
            .padding(.horizontal).padding(.vertical, 6)

            List {
                ForEach($store.accounts) { $a in
                    HStack(spacing: 10) {
                        Toggle("", isOn: $a.selected).labelsHidden().frame(width: 22)
                        TextField("账号名", text: $a.name).textFieldStyle(.plain).frame(width: 120)
                        TextField("备注（手机号 / 用途）", text: $a.note).textFieldStyle(.plain).foregroundColor(.secondary)
                        Circle()
                            .fill(store.status[a.id] == true ? Color.green : Color.gray.opacity(0.45))
                            .frame(width: 8, height: 8)
                            .frame(width: 44)
                            .help(store.status[a.id] == true ? "运行中" : "未运行")
                        Button(store.status[a.id] == true ? "停止" : "启动") {
                            if store.status[a.id] == true { store.stop(a) } else { store.launch(a) }
                        }
                        .frame(width: 56)
                    }
                    .padding(.vertical, 3)
                }
            }
            .listStyle(.inset)

            Divider()

            HStack(spacing: 8) {
                Button("启动所选 (\(store.selectedCount))") { store.launchSelected() }
                Button("全部启动") { store.launchAll() }
                Button("停止所选") { store.stopSelected() }
                Button("全部停止") { store.stopAll() }
                Spacer()
                if !store.errorText.isEmpty {
                    Text(store.errorText).font(.caption).foregroundColor(.red).lineLimit(1)
                }
                Button("删除所选") { store.removeSelected() }.foregroundColor(.red)
                Button("全部删除") { store.removeAll() }.foregroundColor(.red)
                Button("数据目录") { store.openDataFolder() }
            }
            .padding()
        }
        .frame(minWidth: 780, minHeight: 520)
        .onAppear { store.bootstrap() }
        .onDisappear { store.save(force: true) }
    }
}

@main
struct ViberLauncherApp: App {
    @StateObject private var store = Store()

    var body: some Scene {
        WindowGroup("Viber 多开") {
            ContentView(store: store)
        }
        .windowResizability(.contentMinSize)
        .commands { CommandGroup(replacing: .newItem) {} }
    }
}
