"""Installer tests use temporary files and mocked systemd; they never start Hermes."""
import importlib.util
from pathlib import Path
import os
import shutil
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('installer', Path(__file__).resolve().parents[1] / 'scripts/install-services.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='herts-install-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'source with spaces'
        self.root.mkdir()
        (self.root / 'dist').mkdir()
        (self.root / 'dist/index.html').write_text('<title>Fixture</title>')
        shutil.copytree(Path(__file__).resolve().parents[1] / 'deploy', self.root / 'deploy')
        self.units = Path(self.temp.name) / 'units'
        self.home = Path(self.temp.name) / 'hermes'
        self.home.mkdir()
        (self.home / 'config.yaml').write_text('model: fixture\n')
        self.token = Path(self.temp.name) / 'existing-token'
        self.token.write_text('fixture-backend-value\n')
        self.token.chmod(0o600)
        self.port = patch.object(installer, 'free_port').start()
        self.running = patch.object(installer, 'active', return_value=False).start()
        self.exe = patch.object(installer, 'executable', side_effect=lambda value, name: '/usr/bin/' + name).start()
        self.run = patch.object(installer.subprocess, 'run', return_value=type('Result', (), {'stdout': 'v24.1.0', 'returncode': 0})()).start()
        self.addCleanup(patch.stopall)

    def args(self, mode='managed', *more):
        args = ['--mode', mode, '--origin', 'https://herts.example.com', '--identity', 'owner@example.com', '--hermes-home', str(self.home)]
        if mode == 'existing':
            args += ['--backend-url', 'http://127.0.0.1:9999', '--token-file', str(self.token)]
        return installer.parser().parse_args([*args, *more])

    def install(self, args):
        return installer.install(args, self.root, self.units)

    def test_dry_run_has_no_side_effects(self):
        self.install(self.args('managed', '--dry-run'))
        self.assertFalse(self.units.exists())
        self.assertFalse((self.root / 'data').exists())
        self.assertFalse(any(call.args[0][0] == 'systemctl' for call in self.run.call_args_list))

    def test_managed_install_and_identical_rerun_retain_credentials(self):
        self.install(self.args())
        token = (self.root / 'data/backend-token').read_bytes()
        contents = {p: p.read_bytes() for p in (self.root / 'data').iterdir()}
        self.install(self.args())
        self.assertEqual(token, (self.root / 'data/backend-token').read_bytes())
        self.assertEqual(contents, {p: p.read_bytes() for p in contents})
        self.assertEqual((self.root / 'data/app.env').stat().st_mode & 0o777, 0o600)
        self.assertIn('"--isolated"', (self.units / 'herts-backend.service').read_text())
        commands = [c.args[0] for c in self.run.call_args_list]
        self.assertNotIn('restart', repr(commands))
        self.assertIn(['systemctl', '--user', 'enable', '--now', 'herts-backend.service', 'herts.service'], commands)

    def test_existing_mode_never_manages_backend(self):
        self.install(self.args('existing'))
        self.assertEqual([p.name for p in self.units.iterdir()], ['herts.service'])
        self.assertFalse((self.root / 'data/backend.env').exists())
        self.assertFalse((self.root / 'data/backend-token').exists())
        self.assertNotIn('herts-backend.service', repr(self.run.call_args_list))
        self.assertIn('http://127.0.0.1:9999', (self.root / 'data/app.env').read_text())

    def test_changes_or_unrelated_units_fail_before_writes(self):
        self.units.mkdir()
        (self.units / 'herts.service').write_text('unrelated service')
        with self.assertRaisesRegex(ValueError, 'differs'):
            self.install(self.args())
        self.assertFalse((self.root / 'data').exists())
        (self.units / 'herts.service').unlink()
        self.install(self.args())
        old = (self.root / 'data/app.env').read_text()
        with self.assertRaisesRegex(ValueError, 'differs'):
            self.install(self.args('managed', '--identity', 'changed@example.com'))
        self.assertEqual(old, (self.root / 'data/app.env').read_text())

    def test_port_collision_and_unowned_active_service_fail_before_writes(self):
        self.port.side_effect = ValueError('Port occupied')
        with self.assertRaisesRegex(ValueError, 'occupied'):
            self.install(self.args())
        self.assertFalse((self.root / 'data').exists())
        self.port.side_effect = None
        self.running.return_value = True
        with self.assertRaisesRegex(ValueError, 'not owned'):
            self.install(self.args())

    def test_named_profile_and_missing_profile(self):
        with self.assertRaisesRegex(ValueError, 'Configure the selected'):
            self.install(self.args('managed', '--profile', 'research'))
        profile = self.home / 'profiles/research'
        profile.mkdir(parents=True)
        (profile / 'config.yaml').write_text('model: fixture\n')
        self.install(self.args('managed', '--profile', 'research', '--no-start'))
        self.assertIn('HERMES_PROFILE="research"', (self.root / 'data/app.env').read_text())
        self.assertIn('"--profile" "research"', (self.units / 'herts-backend.service').read_text())
        self.assertFalse(any(c.args[0][0] == 'systemctl' for c in self.run.call_args_list))

    def test_rejects_insecure_tokens_origins_and_duplicate_ports(self):
        self.token.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'chmod 600'):
            self.install(self.args('existing'))
        with self.assertRaisesRegex(ValueError, 'HTTPS'):
            self.install(self.args('managed', '--origin', 'http://herts.example.com'))
        with self.assertRaisesRegex(ValueError, 'different ports'):
            self.install(self.args('managed', '--app-port', '8788'))
        self.assertFalse((self.root / 'data').exists())

    def test_systemd_quoting_is_literal_and_rejects_injection(self):
        self.assertEqual(installer.unit_directory('/a b/%name '), '/a b/%%name /.')
        self.assertEqual(installer.unit_quote('/a b/%name/$HOME', True), '"/a b/%%name/$$HOME"')
        self.assertEqual(installer.env_quote('literal"\\path'), '"literal\\"\\\\path"')
        for value in ['name\nExecStart=bad', 'name\r', 'name\x00']:
            with self.assertRaisesRegex(ValueError, 'control characters'):
                installer.unit_quote(value)


if __name__ == '__main__':
    unittest.main()
