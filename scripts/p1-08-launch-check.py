#!/usr/bin/env python3
# P1-08: launch the release .app on a real macOS desktop (CI runner) under four
# conditions and capture per-scenario evidence — main.log/app.log, a screen
# capture, and pass/fail derived from the SQL-init watchdog markers and process
# liveness. The keychain "Always Allow" prompt cannot be clicked on CI; that
# limitation is recorded per scenario rather than worked around.
import json, os, pathlib, shutil, subprocess, sys, tempfile, time

WAIT_SECONDS = 60
ROOT = pathlib.Path.cwd()
OUT = ROOT / 'p1-08'
OUT.mkdir(exist_ok=True)

def sh(*args, check=False):
    return subprocess.run(args, check=check, capture_output=True, text=True)

# --- obtain the .app -------------------------------------------------------
dmg = None
for pattern in ('macos/out/*.dmg', '*.dmg'):
    hits = sorted(ROOT.glob(pattern))
    if hits:
        dmg = hits[0]
        break
if dmg:
    mnt = pathlib.Path('/tmp/haituo-p108-mnt')
    subprocess.run(['hdiutil', 'attach', '-nobrowse', '-quiet',
                    '-mountpoint', str(mnt), str(dmg)], check=True)
    src = next(mnt.glob('*.app'))
    dest = OUT / src.name
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest)
    subprocess.run(['hdiutil', 'detach', str(mnt)], check=True)
    app = dest
else:
    app = next(ROOT.glob('**/*.app'))
exe = next(app.glob('Contents/MacOS/*'))
print(f'app: {app}')

def capture_logs(sdir, homes):
    found = {}
    for home in homes:
        base = home / 'Library' / 'Application Support'
        if not base.exists():
            continue
        for log in sorted(base.glob('*/logs/*.log')):
            target = sdir / log.name
            shutil.copy2(log, target)
            found[log.name] = str(target)
    return found

def judge(sdir, text, alive, homes_desc):
    shot = sdir / 'screen.png'
    shot_bytes = shot.stat().st_size if shot.exists() else 0
    sql_resolved = 'sql.initialize resolved' in text
    watchdog_stall = 'sql.initialize watchdog: still pending' in text
    get_sql_key = [ln for ln in text.splitlines() if 'getSQLKey' in ln]
    app_log_exists = (sdir / 'app.log').exists()
    renderer_up = app_log_exists or 'app ready' in text
    # Screenshot size is only a blank-screen heuristic: a uniform desktop png
    # is far smaller than one with a real window. Logs are the primary signal.
    passed = alive and not watchdog_stall and sql_resolved and renderer_up
    return {
        'passed': passed,
        'process_alive_at_60s': alive,
        'sql_initialize_resolved': sql_resolved,
        'watchdog_stall_logged': watchdog_stall,
        'renderer_log_present': renderer_up,
        'screenshot_bytes': shot_bytes,
        'screenshot_blank_heuristic': shot_bytes < 60_000,
        'user_data': homes_desc,
        'get_sql_key_log': get_sql_key[-6:],
    }

def run_scenario(name, extra_env=None, offline=False, fresh_home=False):
    sdir = OUT / name
    sdir.mkdir(exist_ok=True)
    env = dict(os.environ)
    if extra_env:
        env.update(extra_env)
    homes = [pathlib.Path.home()]
    desc = 'default'
    if fresh_home:
        home = pathlib.Path(tempfile.mkdtemp(prefix='p108-home-'))
        env['HOME'] = str(home)
        homes.insert(0, home)
        desc = f'fresh HOME={home}'
    hosts_backup = None
    if offline:
        hosts_backup = pathlib.Path('/tmp/p108-hosts')
        shutil.copy2('/etc/hosts', hosts_backup)
        subprocess.run("echo '127.0.0.1 *' | sudo tee /etc/hosts",
                       shell=True, check=True, capture_output=True)
    with (sdir / 'stdout.log').open('w') as log:
        proc = subprocess.Popen([str(exe)], env=env, stdout=log,
                                stderr=subprocess.STDOUT, start_new_session=True)
        alive = True
        for _ in range(WAIT_SECONDS // 2):
            time.sleep(2)
            if proc.poll() is not None:
                alive = False
                break
        cap = subprocess.run(['screencapture', '-x', str(sdir / 'screen.png')],
                             capture_output=True, text=True)
        if cap.returncode != 0:
            (sdir / 'screencapture.error.txt').write_text(cap.stderr)
        logs = capture_logs(sdir, homes)
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=10)
    if hosts_backup:
        subprocess.run(['sudo', 'cp', str(hosts_backup), '/etc/hosts'],
                       check=True, capture_output=True)
    text = pathlib.Path(logs.get('main.log', sdir / 'stdout.log'))
    text = text.read_text(errors='replace') if text.exists() else ''
    result = judge(sdir, text, alive, desc)
    result['logs'] = sorted(logs)
    result['notes'] = (
        'Keychain prompts cannot be answered on CI; a stall attributed to '
        'getSQLKey is reported as evidence, not auto-dismissed.'
        if result['get_sql_key_log'] else '')
    print(f"[{name}] {'PASS' if result['passed'] else 'FAIL'} {json.dumps({k: v for k, v in result.items() if k != 'get_sql_key_log'}, ensure_ascii=False)}")
    return result

proxy = 'http://127.0.0.1:9'
results = {
    'normal-network': run_scenario('normal-network'),
    'offline': run_scenario('offline', offline=True),
    'proxy': run_scenario('proxy', {
        'HTTP_PROXY': proxy, 'HTTPS_PROXY': proxy,
        'http_proxy': proxy, 'https_proxy': proxy}),
    'fresh-user-dir': run_scenario('fresh-user-dir', fresh_home=True),
}

(OUT / 'results.json').write_text(json.dumps({
    'app': str(app), 'wait_seconds': WAIT_SECONDS,
    'scenarios': results}, ensure_ascii=False, indent=2))

lines = ['# P1-08 macOS launch check (1.5.1)', '',
         '| scenario | result | alive@60s | sql.init resolved | watchdog stall | shot bytes |', '|---|---|---|---|---|---|']
for name, r in results.items():
    lines.append(f"| {name} | {'PASS' if r['passed'] else 'FAIL'} | "
                 f"{r['process_alive_at_60s']} | {r['sql_initialize_resolved']} | "
                 f"{r['watchdog_stall_logged']} | {r['screenshot_bytes']} |")
(OUT / 'SUMMARY.md').write_text('\n'.join(lines) + '\n')
print('\n'.join(lines))
sys.exit(0 if all(r['passed'] for r in results.values()) else 1)
