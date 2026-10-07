"""Exercise the compiled updater in an isolated miniature portable installation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid
import zipfile
from contextlib import closing

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from update_helper import digest, EXE, MANIFEST, UPDATE_WORK, validate_program


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--helper', type=Path, required=True)
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--update-package', action='store_true', help='Use the lean update package name')
    args = parser.parse_args()
    root = args.data_dir.resolve()
    if root.exists(): parser.error('Use a new test directory')
    root.mkdir(parents=True)
    program, fresh, data = root / 'program', root / 'fresh', root / 'user-data'
    folder = data / 'Updates' / uuid.uuid4().hex
    folder.mkdir(parents=True)
    compiler = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    for path, version in [(program, '0.3.0'), (fresh, '0.4.0')]:
        path.mkdir()
        source = root / ('fixture-' + version + '.cs')
        source.write_text('''using System; using System.IO; using System.Threading;
class App { static void Main(string[] args) {
 string root=args[Array.IndexOf(args,"--data-dir")+1];
 if(Array.IndexOf(args,"--hold")>=0) { File.WriteAllText(Path.Combine(root,"parent-ready"),"ready"); while(!File.Exists(Path.Combine(root,"exit-parent"))) Thread.Sleep(50); }
 else File.WriteAllText(Path.Combine(root,"restarted"),"''' + version + '''");
} }''', encoding='utf-8')
        subprocess.run([str(compiler), '/nologo', '/target:winexe', '/out:' + str(path / EXE), str(source)], check=True)
        (path / MANIFEST).write_text(json.dumps({'product': 'CitizenTools', 'version': version, 'files': [EXE]}))
    (program / 'personal.txt').write_text('preserve this file')
    (data / 'Sounds').mkdir(); (data / 'Sounds/click.wav').write_bytes(b'personal sound')
    (data / 'data').mkdir()
    with closing(sqlite3.connect(data / 'data/cargo_planner.sqlite3')) as connection:
        connection.execute('create table example(value text)')
        connection.execute("insert into example values ('my contract')"); connection.commit()
    package = folder / ('CitizenTools-Solo-Update.zip' if args.update_package else 'CitizenTools-Solo-Portable.zip')
    with zipfile.ZipFile(package, 'w') as archive:
        for file in fresh.iterdir(): archive.write(file, 'CitizenTools-Solo/' + file.name)
    copied_helper = folder / 'CitizenTools-Updater.exe'; shutil.copy2(args.helper, copied_helper)
    parent = subprocess.Popen([str(program / EXE), '--data-dir', str(data), '--hold'])
    def wait_for(file, timeout=40):
        deadline = time.monotonic() + timeout
        while not file.exists():
            if time.monotonic() > deadline: raise AssertionError('Timeout waiting for ' + str(file))
            time.sleep(.1)
    updater = None
    try:
        wait_for(data / 'parent-ready')
        job = {'format': 1, 'parentPid': parent.pid, 'program': str(program), 'dataRoot': str(data),
            'package': str(package), 'sha256': digest(package), 'oldExeSha256': digest(program / EXE),
            'kind': 'portable', 'version': '0.4.0', 'currentVersion': '0.3.0', 'restartArgs': ['--data-dir', str(data)]}
        job_path = folder / 'job.json'; job_path.write_text(json.dumps(job))
        updater = subprocess.Popen([str(copied_helper), '--job', str(job_path)], creationflags=subprocess.CREATE_NO_WINDOW)
        wait_for(folder / 'helper-ready')
        time.sleep(.5)
        assert parent.poll() is None and updater.poll() is None
        assert digest(program / EXE) == job['oldExeSha256'], 'Files changed while parent was alive'
        (data / 'exit-parent').write_text('exit')
        parent.wait(10)
        assert updater.wait(60) == 0
        wait_for(data / 'restarted')
        assert (data / 'restarted').read_text() == '0.4.0'
        validate_program(program, '0.4.0')
        assert (program / 'personal.txt').read_text() == 'preserve this file'
        assert (data / 'Sounds/click.wav').read_bytes() == b'personal sound'
        with closing(sqlite3.connect(folder / 'data-backup/cargo_planner.sqlite3')) as connection:
            assert connection.execute('select value from example').fetchone()[0] == 'my contract'
        report = json.loads((folder / 'result.json').read_text())
        assert report['ok']; validate_program(Path(report['backup']), '0.3.0')
        assert Path(report['backup']).parent == program / UPDATE_WORK
        assert not list((program / UPDATE_WORK).glob('update-*'))
        assert not list(root.glob('.program.*'))
        report['checks'] = ['wait-for-running-parent', 'replace-in-same-directory', 'preserve-extra-files', 'preserve-sounds', 'consistent-data-backup', 'previous-program-backup', 'restart-new-version']
        (root / 'helper-result.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
    finally:
        (data / 'exit-parent').write_text('exit')
        parent.wait(10)
        if updater and updater.poll() is None:
            # Our own isolated test helper only; never touch the user's app.
            updater.terminate(); updater.wait(10)
    return 0


if __name__ == '__main__': raise SystemExit(main())
