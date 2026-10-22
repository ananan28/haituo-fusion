"""Create a portable, platform-labelled source snapshot from tracked project files."""
import argparse, hashlib, json, pathlib, subprocess, zipfile

root=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--target',choices=['windows','macos'],required=True);args=parser.parse_args()
version=json.loads((root/'project.json').read_text(encoding='utf-8'))['versions'][args.target]
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
paths=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')
label='Windows' if args.target=='windows' else 'macOS'
name=f'Haituo-{version}-{label}-Source'
out=root/'source-packages';out.mkdir(exist_ok=True)
manifest={}
with zipfile.ZipFile(out/(name+'.zip'),'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for rel in paths:
        if not rel:continue
        path=root/rel
        if not path.is_file():raise RuntimeError('Missing tracked file: '+rel)
        data=path.read_bytes();manifest[rel]=hashlib.sha256(data).hexdigest();archive.write(path,name+'/'+rel)
    archive.writestr(name+'/SOURCE-SNAPSHOT.json',json.dumps({'version':version,'platform':args.target,'commit':commit,'files':manifest},ensure_ascii=False,indent=2))
    archive.writestr(name+'/BUILD-THIS-PLATFORM.txt',f'海拓 {version} {label} 开发工程\n\n先安装 Python 3.12、Node.js 22 和 Git。\n在{label}电脑进入本目录执行：\npython scripts/build.py --target {args.target} --test\n\n包含当前客户端运行代码、资源、依赖、构建及测试，可换电脑或仓库继续开发。\n首次构建需要联网下载 Electron、工具及平台原生依赖。\n原始 TS/TSX、未取得的私有后端不在此包，详见 START-HERE.md。\n不包含聊天数据、账号会话或个人 API 密钥。\nGit commit: {commit}\n')
with zipfile.ZipFile(out/(name+'.zip')) as archive:
    assert archive.testzip() is None
    for rel,expected in manifest.items():assert hashlib.sha256(archive.read(name+'/'+rel)).hexdigest()==expected
print(out/(name+'.zip'))
