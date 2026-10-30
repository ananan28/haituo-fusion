import SwiftUI
import Foundation
import Darwin

struct Account: Identifiable, Codable, Equatable {
    var id: String
    var name: String
    var note: String
    var enabled: Bool

    static func make(index: Int) -> Account {
        Account(id: UUID().uuidString, name: "账号 \(index)", note: "", enabled: false)
    }
}

final class Store: ObservableObject {
    @Published var accounts: [Account] = []
    @Published var status: [String: Bool] = [:]
    @Published var errorText: String = ""

    let base = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("ViberMulti", isDirectory: true)
    var viberPath: String {
        let candidates = [
            "/Applications/Viber.app/Contents/MacOS/Viber",
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/Viber.app/Contents/MacOS/Viber").path
        ]
        for c in candidates where FileManager.default.isExecutableFile(atPath: c) { return c }
        return candidates[0]
    }

    private var stateFile: URL { base.appendingPathComponent("accounts.json") }
    private var lastSaved: String = ""

    func bootstrap() {
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: stateFile),
           let list = try? JSONDecoder().decode([Account].self, from: data),
           !list.isEmpty {
            accounts = list
        } else {
            accounts = (1...4).map { Account.make(index: $0) }
            save(force: true)
        }
        refreshStatus()
    }

    func profileDir(_ a: Account) -> URL { base.appendingPathComponent("profiles/\(a.id)", isDirectory: true) }
    func tempDir(_ a: Account) -> URL { base.appendingPathComponent("tmp/\(a.id)", isDirectory: true) }
    private func pidFile(_ a: Account) -> URL { profileDir(a).appendingPathComponent(".pid") }

    func add() {
        accounts.append(Account.make(index: accounts.count + 1))
        save(force: true)
    }

    func remove(_ a: Account) {
        stop(a)
        accounts.removeAll { $0.id == a.id }
        save(force: true)
        refreshStatus()
    }

    func save(force: Bool = false) {
        guard force || serialized() != lastSaved else { return }
        lastSaved = serialized()
        if let data = try? JSONEncoder().encode(accounts) {
            try? data.write(to: stateFile, options: .atomic)
        }
    }

    private func serialized() -> String {
        (try? JSONEncoder().encode(accounts)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    }

    func launch(_ a: Account) {
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
            errorText = ""
        } catch {
            errorText = "启动失败: \(error.localizedDescription)"
        }
        refreshStatus()
    }

    func launchSelected() {
        for a in accounts where a.enabled && status[a.id] != true {
            launch(a)
        }
    }

    func stop(_ a: Account) {
        let pid = readPid(a)
        if pid > 0 { kill(pid, SIGTERM) }
        try? FileManager.default.removeItem(at: pidFile(a))
        refreshStatus()
    }

    func stopAll() {
        for a in accounts { stop(a) }
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
        status = next
    }
}

struct ContentView: View {
    @ObservedObject var store: Store
    private let ticker = Timer.publish(every: 2, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("Viber 多开").font(.title3).bold()
                Spacer()
                Text(store.viberPath).font(.caption).foregroundColor(.secondary).lineLimit(1).truncationMode(.middle)
            }
            .padding(.horizontal).padding(.top).padding(.bottom, 8)

            Divider()

            List {
                ForEach($store.accounts) { $a in
                    HStack(spacing: 10) {
                        Toggle("", isOn: $a.enabled).labelsHidden().help("勾选后可随「启动所选」一起启动")

                        VStack(alignment: .leading, spacing: 2) {
                            TextField("账号名", text: $a.name).textFieldStyle(.plain).font(.body)
                            TextField("备注（手机号 / 用途 / 归属）", text: $a.note).textFieldStyle(.plain).font(.caption).foregroundColor(.secondary)
                        }

                        Spacer(minLength: 8)

                        Circle()
                            .fill(store.status[a.id] == true ? Color.green : Color.gray.opacity(0.5))
                            .frame(width: 8, height: 8)
                            .help(store.status[a.id] == true ? "运行中" : "未运行")

                        Button(store.status[a.id] == true ? "停止" : "启动") {
                            if store.status[a.id] == true { store.stop(a) } else { store.launch(a) }
                        }
                        .frame(width: 58)

                        Button("删除") { store.remove(a) }.foregroundColor(.red)
                    }
                    .padding(.vertical, 4)
                }
            }
            .listStyle(.inset)

            Divider()

            HStack {
                Button("添加账号") { store.add() }
                Button("打开配置目录") {
                    NSWorkspace.shared.open(store.base)
                }
                Spacer()
                if !store.errorText.isEmpty {
                    Text(store.errorText).font(.caption).foregroundColor(.red).lineLimit(1)
                }
                Button("全部停止") { store.stopAll() }
                Button("启动所选") { store.launchSelected() }.keyboardShortcut(.defaultAction)
            }
            .padding()
        }
        .frame(minWidth: 660, minHeight: 440)
        .onAppear { store.bootstrap() }
        .onReceive(ticker) { _ in
            store.refreshStatus()
            store.save()
        }
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
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}
