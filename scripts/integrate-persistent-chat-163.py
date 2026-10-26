from pathlib import Path
import hashlib,subprocess,json
root=Path(__file__).resolve().parent.parent
expected=json.loads("{\"CHANGELOG-1.6.3.md\":\"c25a71bbe97c9b172a57644bafa3f73de9521a411d5ce071dc3ad0d67d6ce472\",\"INPROCESS-1.6.3.md\":\"427c13f1e2e8e6c40c462fbea73184371ca7229a708f8d1e695fd287e61f5fe4\",\"README.md\":\"1f7a39a82259600d85bc5f8ef45ba5d3766f05b85cea9b2d09d8f4c8ca9f9a69\",\"START-HERE.md\":\"48a76105b6b90624047705fe6497ae1274dbef0bc568c786d329d4f39bc5a030\",\"project.json\":\"83130b699973b6525740be0d5769e57a550d0e344858a8d0436068dfce8e9315\",\"scripts/default-embedded-launch.test.cjs\":\"19c811aa25fd0c689d21746c3859f0015c814b46f9b59f87084c1683bcaa91bc\",\"scripts/inprocess-native-check.cjs\":\"097e98857638c65ac75c7cc650ecf04bab6764d21f137bb93e55e8bef4e26200\",\"scripts/local-chat-layout-fixture.cjs\":\"cae62567ecfa9a3eb8e79a2433ee72a60df4b333c68c3dd1b15ceae32df07ddd\",\"scripts/local-chat-sqlite.test.cjs\":\"16dcb9ee36610d37af56379bd6476758c28f8c5b383505da4b2444a816c8cd4b\",\"scripts/local-chat-view.dom.cjs\":\"a5383e7dad463cbb33c1f661addf6f205570888f238c7d54ceb1e76e3bd9e23e\",\"scripts/native-attachments-check.cjs\":\"d0550738735d697d2a50d87103cf812dc19e079c0d8f41dfb83126cb6f9ce1f4\",\"scripts/translate-core.test.cjs\":\"085463f9c2c5ac10045340625d29c24c3a2529f77b9e84a1864e05fbb40104c6\",\"scripts/whatsapp-records-scanner.dom.cjs\":\"31375e0b7454393ae6fe5516f3830a73b0e6e9a1089924c6f90b50a93525fa4d\",\"src/app/bundles/main.js\":\"f3ef1de49808ab7ebb01049017987bf5c410c3908ea7905297a1427f7f5223be\",\"src/app/bundles/preload/main.js\":\"cd40ea7e22c644a93941dec510b48aa595385411a8a7d8b63ea48be17418f791\",\"src/app/js/caisheng-webview-preload.js\":\"c51f18ad93992349c2e88fdd1115eefb9e6fefaf254efe2f57c2376a6d72927e\",\"src/app/js/haituo-local-chat-records.js\":\"1d1753caeb84814505508e95539e6d313bc649ef59e1ba85bc680d42b74c74f9\",\"src/app/js/haituo-local-chat-view.js\":\"15db77b58d7163ceac67d93f04148ee55b129e631e7a8f49773bfa296adcba2e\"}")
def matches():
 return all((root/name).is_file() and hashlib.sha256((root/name).read_text(encoding='utf-8').encode()).hexdigest()==value for name,value in expected.items())
def apply(name):
 subprocess.run(['git','apply','--check',name],cwd=root,check=True)
 subprocess.run(['git','apply',name],cwd=root,check=True)
if not matches():
 if json.loads((root/'project.json').read_text())['versions']['windows']!='1.6.3':apply('scripts/persistent-chat-163.patch')
 if not matches():apply('scripts/persistent-chat-mask-163.patch')
if not matches():raise SystemExit('1.6.3 integration does not match reviewed source')
print('Verified complete 1.6.3 editable source: '+str(len(expected))+' files')
