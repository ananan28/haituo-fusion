"""Apply reviewed, exact Signal translation-only replacements; leave every other byte unchanged."""
import json,pathlib
ROOT=pathlib.Path(__file__).resolve().parent.parent
def apply(source):
    for edit in json.loads((ROOT/'scripts/backtranslation-switch-patch.json').read_text(encoding='utf-8')):
        old,new=edit['old'],edit['new']
        if source.count(new)==1:continue
        if old not in source:raise RuntimeError('Signal translation patch anchor drift: '+old[:100])
        if source.count(old)!=1:raise RuntimeError('Ambiguous Signal translation patch anchor: '+old[:100])
        source=source.replace(old,new,1)
    return source
if __name__=='__main__':
    path=ROOT/'src/app/bundles/preload/main.js';before=path.read_text(encoding='utf-8');after=apply(before)
    if after!=before:path.write_text(after,encoding='utf-8')
    print('Signal translation switch patch applied (idempotent); no core message/schema changes.')
