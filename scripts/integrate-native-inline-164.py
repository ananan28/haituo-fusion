from pathlib import Path
import hashlib,subprocess,json,sys
root=Path(__file__).resolve().parent.parent
expected=json.loads("{\"project.json\":\"be46a1a6f18fc5129ca764120d8936c6bc33d33f402961ec9f85351e3eb85bbc\",\"README.md\":\"52cf2b25d628a2c8894a88e8399769674702ecc0bd1d94f3694f89711eabe6e5\",\"START-HERE.md\":\"ff83c78e11bf5e13e0bf5c7a2a0e9d4feab02f6b4c882c975439e3bf3bd796db\",\"CHANGELOG-1.6.4.md\":\"a0f083cf7ce4b5688d6dd9b762e29fe213a6364c0140fbe82434bad48cf7972c\",\"INPROCESS-1.6.4.md\":\"55a09646f943a6515b09c56aecd3bf21f17aa8956898739c6dd039997c08ee60\",\"src/app/bundles/main.js\":\"cbe40875913fb7ba3629974f230e51f815b80ee4b632e9641bf0198b06646943\",\"src/app/js/haituo-local-chat-view.js\":\"b82720dab20c8a34942da62c2a40877c1df628dee6d89ad17312a727ff797a73\",\"src/app/js/caisheng-webview-preload.js\":\"88b9fffb32818f55f82bf24c4377bed1e4b32b2461e08b890c77d1074953c03d\",\"scripts/local-chat-view.dom.cjs\":\"97c546ba37b72c970fb807e5c1bd839a9d77834ee87884c26c3ebcf8e241fc4c\",\"scripts/whatsapp-records-scanner.dom.cjs\":\"d15c1eddbede07285a1660fac84eb7396532e9a8b561c5622aca50c9efa4795d\",\"scripts/local-chat-layout-fixture.cjs\":\"983e5c5d458f3f9e64d93ab7b67a03c62f5c2915898594c2ab36cd7a00478e79\",\"scripts/local-chat-chromium-check.cjs\":\"4ad34d36b36dc76331c2d0107bb2cde0fcad575108011c86dd140272a7a51345\",\"scripts/native-attachments-check.cjs\":\"383b098c2205ea08d88827f1d76ba03300cac0fed4730642877f4afe2e6d9314\",\"scripts/inprocess-native-check.cjs\":\"848abffe811960bb84539dc93a2ea79668b2828dfdc7352b5698ca7b9aba95a0\",\"scripts/config-secret-save.test.cjs\":\"b267f0f4b4fb9bcf73ad7b36ef2fc3c3692e1a67c664a96ad602f97a248a3447\",\"scripts/startup-settings-sync.test.cjs\":\"32b7afb971b1ea2a742e19d8d9d8ab2585c970095b76ee5a40cfcfce41b1027e\"}")
def matches():
 return all((root/name).is_file() and hashlib.sha256((root/name).read_text(encoding='utf-8').encode()).hexdigest()==value for name,value in expected.items())
subprocess.run([sys.executable,'scripts/sync-local-chat-view.py'],cwd=root,check=True)
if not matches():
 subprocess.run(['git','apply','--check','scripts/native-inline-164.patch'],cwd=root,check=True)
 subprocess.run(['git','apply','scripts/native-inline-164.patch'],cwd=root,check=True)
if not matches():raise SystemExit('1.6.4 source differs from reviewed native-UI fix')
print('Verified complete 1.6.4 editable source: '+str(len(expected))+' files')
