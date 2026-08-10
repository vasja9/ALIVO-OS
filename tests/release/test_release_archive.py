import importlib.util
from pathlib import Path

def test_release_contract_constants():
 p=Path(__file__).parents[2]/'scripts/create_release_archive.py';s=importlib.util.spec_from_file_location('archive',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
 assert m.VERSION=='1.0.0';assert m.SETUP=='ALIVO-OS-v1.0.0-Setup.exe';assert 'package-lock.json' in m.REQUIRED
 assert {'.db','.pfx','.key'} <= m.DANGEROUS_EXT
