"""Grant only the test app/helper permissions on an ephemeral GitHub macOS runner."""
import os, pathlib, subprocess, sys, time, json
if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_OS") != "macOS":
    raise SystemExit("CI-only permission fixture; never run on a user computer")
app=pathlib.Path(sys.argv[1]).resolve()
workspace=pathlib.Path(os.environ["GITHUB_WORKSPACE"]).resolve()
if not app.is_relative_to(workspace/"macos/out") or app.name!="海拓.app":
    raise SystemExit("Unexpected test application path")
helper=app/"Contents/Resources/app.asar.unpacked/native/haituo-viber-fusion"
clients=[("com.haituo.desktop",0,app),(str(helper),1,helper)]
def requirement(target):
    result=subprocess.run(["/usr/bin/codesign","-dr","-",str(target)],capture_output=True,text=True,check=True)
    text=result.stderr+result.stdout
    line=next(line.split("designated => ",1)[1] for line in text.splitlines() if "designated => " in line)
    output=pathlib.Path(os.environ["RUNNER_TEMP"])/("viber-tcc-"+str(len(str(target)))+".csreq")
    subprocess.run(["/usr/bin/csreq","-r-","-b",str(output)],input=line,text=True,check=True)
    return output.read_bytes().hex()
databases=[pathlib.Path.home()/"Library/Application Support/com.apple.TCC/TCC.db",pathlib.Path("/Library/Application Support/com.apple.TCC/TCC.db")]
for database in databases:
    if not database.exists():
        raise SystemExit("Runner TCC database unavailable; cannot certify installed-app permissions")
    schema=json.loads(subprocess.check_output(["sudo","sqlite3","-json",str(database),"PRAGMA table_info(access);"],text=True))
    columns={row["name"] for row in schema}
    if not {"auth_value","auth_reason","auth_version"}.issubset(columns):
        raise SystemExit("Unexpected runner TCC schema")
    for service in ["kTCCServiceScreenCapture","kTCCServiceAccessibility"]:
        for client,kind,target in clients:
            values={"service":service,"client":client,"client_type":kind,"auth_value":2,"auth_reason":3,"auth_version":1,
                    "csreq":("blob",requirement(target)),"indirect_object_identifier_type":0,
                    "indirect_object_identifier":"UNUSED","flags":0,"last_modified":int(time.time())}
            values={key:value for key,value in values.items() if key in columns}
            def literal(value):
                if isinstance(value,tuple):return "X'"+value[1]+"'"
                if isinstance(value,int):return str(value)
                return "'"+value.replace("'","''")+"'"
            sql="INSERT OR REPLACE INTO access ("+",".join(values)+") VALUES ("+",".join(literal(value) for value in values.values())+");"
            subprocess.run(["sudo","sqlite3",str(database),sql],check=True)
    print("CI_TCC_TEST_APP_RECORDS_CONFIGURED="+str(database.name))
subprocess.run(["/usr/bin/killall","tccd"],check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
print("CI_TCC_FIXTURE_COMPLETE: test app and helper only; no user-machine changes")
