import json, os, pathlib, plistlib, signal, subprocess, tempfile, time

app = pathlib.Path('macos/out/海拓-darwin-arm64/海拓.app/Contents/MacOS/海拓').resolve()
assert plistlib.loads((app.parent.parent/'Info.plist').read_bytes()).get('LSUIElement') is not True
out = pathlib.Path('macos/verification').resolve()
out.mkdir(parents=True, exist_ok=True)
order_tool=out/'window-order'
subprocess.run(['swiftc','repair/window-order.swift','-o',str(order_tool)],check=True)
result = out / 'runtime.json'
with tempfile.TemporaryDirectory(prefix='haituo-verify-') as profile:
    env = {**os.environ, 'HAITUO_VERIFY_RUNTIME': '1', 'HAITUO_VERIFY_RESULT': str(result), 'HAITUO_WINDOW_ORDER_TOOL':str(order_tool)}
    with (out / 'startup.log').open('w') as log:
        process = subprocess.Popen([str(app), '--user-data-dir='+profile], env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            deadline = time.time()+420
            while not result.exists() and process.poll() is None and time.time()<deadline:
                time.sleep(1)
            if not result.exists():
                print((out/'startup.log').read_text(errors='replace')[-8000:])
                raise RuntimeError('Runtime verification produced no result')
            report=json.loads(result.read_text())
            print(json.dumps(report, ensure_ascii=False))
            if not report['ok']:
                print((out/'startup.log').read_text(errors='replace')[-12000:])
                raise RuntimeError(report['error'])
        finally:
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
