#!/usr/bin/env python3
"""Fail-closed ALIVO OS FULL release archive assembler and verifier."""
from __future__ import annotations
import hashlib, json, os, re, shutil, subprocess, sys, tempfile, zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text())['version']
NAME=f'ALIVO-OS-v{VERSION}-FULL'
SETUP=f'ALIVO-OS-v{VERSION}-Setup.exe'
OUT=ROOT/'release'; INSTALLER=OUT/'installer'/SETUP
REQUIRED=['package.json','package-lock.json','Makefile','tsconfig.json','src','electron','ui','tests','docs','migrations','config-templates','licenses']
EXCLUDED_PREFIXES=('.git/','node_modules/','dist/','release/')
DANGEROUS_EXT={'.db','.sqlite','.sqlite3','.pfx','.p12','.key','.pem'}
SECRET=re.compile(rb'(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|master[_-]?password|authorization)\s*[:=]\s*["\']?(?!<|undefined|null|false|true)[A-Za-z0-9+/_.=-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')
PATHS=re.compile(rb'(?i)(?:/home/[^/\s]+|/mnt/data/|[A-Z]:\\Users\\[^\\\s]+|/workspace/ALIVO-OS)')

def run(*args:str)->str:return subprocess.check_output(args,cwd=ROOT,text=True).strip()
def sha(path:Path)->str:
 h=hashlib.sha256();
 with path.open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def tracked()->list[str]:return [x for x in run('git','ls-files').splitlines() if x and not x.startswith(EXCLUDED_PREFIXES)]
def audit(files:list[str])->None:
 if run('git','status','--porcelain'):raise SystemExit('FAIL: repository must be clean')
 for item in REQUIRED:
  if not (ROOT/item).exists():raise SystemExit(f'FAIL: required source missing: {item}')
 if not INSTALLER.is_file() or INSTALLER.stat().st_size==0:raise SystemExit(f'FAIL: certified installer missing: {INSTALLER}')
 if INSTALLER.name!=SETUP:raise SystemExit('FAIL: Setup filename/version mismatch')
 for rel in files:
  p=ROOT/rel
  if p.suffix.lower() in DANGEROUS_EXT:raise SystemExit(f'FAIL: prohibited database/signing file: {rel}')
  data=p.read_bytes()
  if SECRET.search(data):raise SystemExit(f'FAIL: possible live secret: {rel}')
  if PATHS.search(data):raise SystemExit(f'FAIL: developer absolute path: {rel}')
 if any('video' in PurePosixPath(x).name.lower() for x in files if x.startswith(('src/','ui/','electron/'))):raise SystemExit('FAIL: Video functionality/assets detected')

def main()->None:
 files=tracked();audit(files); commit=run('git','rev-parse','HEAD'); timestamp=datetime.now(timezone.utc).replace(microsecond=0).isoformat()
 with tempfile.TemporaryDirectory(prefix='alivo-full-') as td:
  stage=Path(td)/NAME
  for d in ['README','installer','source','build','migrations','config-templates','docs','manifests','licenses','recovery']: (stage/d).mkdir(parents=True)
  for rel in files:
   target=stage/'source'/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/rel,target)
  shutil.copy2(INSTALLER,stage/'installer'/SETUP)
  for directory in ['migrations','config-templates','licenses']:
   shutil.copytree(ROOT/directory,stage/directory,dirs_exist_ok=True)
  docs={
   'README/README.md':f'# ALIVO OS {VERSION} FULL archive\n\nPermanent application/source preservation archive. Install with `installer/{SETUP}`; rebuild using `build/BUILD.md`; use `recovery/RECOVERY.md` for state restoration. It excludes operational databases, backups, Vault contents, secrets, caches, dependencies and private signing material. Keep the external SHA-256 and multiple copies on independent storage. A FULL archive never substitutes for monthly `ALIVO-OS-BACKUP-YYYY-MM-*.zip` assets.\n',
   'README/INSTALL.md':f'# Install\n\nOn supported 64-bit Windows, copy the archive locally, verify its external SHA-256, extract it, verify `manifests/SHA256SUMS`, and run `installer/{SETUP}`. Complete First-Run Onboarding and choose Start New for clean schema-1 state, or Recover Existing to hand off to Recovery Manager. Installation is self-contained; integrations require network and credential authorization. The installer is unsigned.\n',
   'README/REINSTALL.md':'# Reinstall\n\nApplication files are separate from Persistent State, the encrypted Credential Vault, monthly Backup assets, and Cache/Temporary files. Reinstalling application files must not delete healthy persistent state. Preserve state and Vault before reinstalling; credentials may require re-entry.\n',
   'build/BUILD.md':'# Rebuild\n\nUse 64-bit Windows 10/11, Node 22, npm 10+, TypeScript 5.9, Electron 37 and electron-builder 26. Run `npm ci`, `make test`, `make build`, `make desktop-smoke`, and `make package-windows` in `source/`. Output: `dist/ALIVO-OS-v1.0.0-Setup.exe`. `@types/node` is declared in package.json/lockfile; no local path workaround is used. Registry access is required unless dependencies were independently cached. Registry artifacts may disappear; the lockfile preserves resolved metadata and integrity hashes. Installer bytes can vary due to timestamps, compression and signing.\n',
   'recovery/RECOVERY.md':'# Recovery\n\nFULL restores the application; BACKUP restores persistent history and learning. Neither replaces the other. Recovery Manager may discover verified backups and salvage valid newer historical state. Schema 1, backup format 1, and minimum restore version 1.0.0 are recorded in the manifest. Credentials and Vault material are deliberately excluded and can require reauthorization. Each Business Package is an isolation boundary; never merge records across package identifiers by assumption.\n',
   'docs/RELEASE_NOTES.md':'# 1.0.0 release notes\n\nInitial production archive. Known limitations: installer is unsigned; clean Windows installation, Windows launch, onboarding and installer rebuild require external Windows certification and were not executable in the Linux archive environment. No offline source dependency cache is included.\n',
   'docs/DATA_LOCATIONS.md':'# Data separation\n\nApplication binaries are installed under the operating system selected application location. Persistent State, Credential Vault, Backup, and Cache/Temporary are distinct categories stored through platform APIs, never a hard-coded user path. Business Package identifiers scope all operational records. Cache is disposable; state, Vault and backups are not.\n'}
  for rel,body in docs.items():(stage/rel).write_text(body,encoding='utf-8')
  manifest={'product':'ALIVO OS','releaseVersion':VERSION,'releaseCommit':commit,'buildTimestamp':timestamp,'targetOS':'Windows 10/11','targetArchitecture':'x64','installerFilename':SETUP,'installerSize':INSTALLER.stat().st_size,'installerChecksum':sha(INSTALLER),'archiveFormatVersion':1,'databaseSchemaVersion':1,'backupCompatibilityVersion':1,'minimumSupportedRestoreVersion':'1.0.0','signingState':'Unsigned','testCertificationState':'Linux source checks passed; Windows install/launch pending external certification'}
  (stage/'manifests/release.json').write_text(json.dumps(manifest,indent=2)+'\n')
  inventory=sorted(str(x.relative_to(stage)).replace(os.sep,'/') for x in stage.rglob('*') if x.is_file())
  (stage/'manifests/INVENTORY.txt').write_text('\n'.join(inventory)+'\n')
  checksum_files=sorted(x for x in stage.rglob('*') if x.is_file() and x.name!='SHA256SUMS')
  (stage/'manifests/SHA256SUMS').write_text('\n'.join(f'{sha(x)}  {x.relative_to(stage).as_posix()}' for x in checksum_files)+'\n')
  archive=OUT/f'{NAME}.zip';archive.unlink(missing_ok=True)
  with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,allowZip64=True) as z:
   for p in sorted(stage.rglob('*')):
    if p.is_file():z.write(p,p.relative_to(stage.parent))
  external=OUT/f'{NAME}.zip.sha256';external.write_text(f'{sha(archive)}  {archive.name}\n')
  with tempfile.TemporaryDirectory(prefix='ALIVO archive verification with spaces ') as verify:
   with zipfile.ZipFile(archive) as z:z.testzip() is None or (_ for _ in()).throw(SystemExit('FAIL: corrupt ZIP'));z.extractall(verify)
   extracted=Path(verify)/NAME
   for line in (extracted/'manifests/SHA256SUMS').read_text().splitlines():
    digest,rel=line.split('  ',1)
    if sha(extracted/rel)!=digest:raise SystemExit(f'FAIL: checksum mismatch: {rel}')
   if sha(extracted/'installer'/SETUP)!=sha(INSTALLER):raise SystemExit('FAIL: extracted installer mismatch')
  print(json.dumps({'archive':str(archive),'size':archive.stat().st_size,'sha256':sha(archive),'installerSha256':sha(INSTALLER),'releaseCommit':commit},indent=2))
if __name__=='__main__':main()
