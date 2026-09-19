#!/usr/bin/env python3
"""Install a new Herts instance without replacing configuration or other services."""
import argparse
from pathlib import Path
import os
import re
import secrets
import shutil
import socket
import subprocess
from urllib.parse import urlsplit


def fail(message):
    raise ValueError(message)


def clean(value):
    value = str(value)
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        fail('Configuration values must not contain control characters.')
    return value


def env_quote(value):
    return '"' + clean(value).replace('\\', '\\\\').replace('"', '\\"') + '"'


def unit_quote(value, command=False):
    # systemd expands % specifiers and, in ExecStart, $ variables even in quotes.
    value = clean(value).replace('%', '%%')
    if command:
        value = value.replace('$', '$$')
    return env_quote(value)


def unit_directory(value):
    # WorkingDirectory takes a literal path, unlike ExecStart/EnvironmentFile.
    # A final /. also protects trailing spaces from unit-file whitespace trimming.
    return clean(value).replace('%', '%%') + '/.'


def render(root, name, values):
    return re.sub(r'@[A-Z]+@', lambda match: values[match.group()], (root / 'deploy' / name).read_text())


def origin(value, backend=False):
    value = clean(value)
    try:
        u = urlsplit(value)
        port = u.port
    except ValueError:
        fail('Invalid origin or port.')
    if not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('', '/'):
        fail('Use an HTTP(S) origin without credentials, path, query or fragment.')
    if u.scheme != 'https' and not (backend and u.scheme == 'http' and u.hostname in ('127.0.0.1', 'localhost', '::1')):
        fail('HTTPS is required, except for a loopback Hermes backend.')
    if not backend and value.endswith('/'):
        fail('The app origin must not have a trailing slash.')
    return value.rstrip('/')


def executable(value, name):
    path = shutil.which(value or name)
    if not path:
        fail(f'{name} executable was not found. Supply its absolute path.')
    # Keep a virtualenv entry point's spelling; resolving symlinks can escape it.
    return str(Path(path).absolute())


def free_port(port):
    with socket.socket() as probe:
        try:
            probe.bind(('127.0.0.1', port))
        except OSError:
            fail(f'Port {port} is occupied. Select another port or explicitly use --mode existing. No process was stopped or reused.')


def active(unit):
    return subprocess.run(['systemctl', '--user', 'is-active', '--quiet', unit], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False).returncode == 0


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode', choices=['managed', 'existing'], required=True)
    p.add_argument('--origin', required=True, help='Your app’s Tailscale HTTPS origin, without a trailing slash')
    p.add_argument('--identity', required=True, help='Exact Tailscale user login (not display name)')
    p.add_argument('--profile', default='default', help='Existing Hermes profile name')
    p.add_argument('--plugins-dir', type=Path, help='Prepared plugin directory; defaults to CHECKOUT/plugins')
    p.add_argument('--data-dir', type=Path, help='Private persistent storage; defaults to CHECKOUT/data')
    p.add_argument('--app-port', type=int, default=8787)
    p.add_argument('--backend-port', type=int, default=8788, help='Managed mode only')
    p.add_argument('--hermes-home', type=Path, default=Path.home() / '.hermes', help='Root Hermes home; named profiles live under profiles/NAME')
    p.add_argument('--hermes-bin', help='Managed mode: Hermes executable')
    p.add_argument('--node', help='Node.js 24+ executable')
    p.add_argument('--backend-url', help='Existing mode: Desktop-compatible backend origin')
    p.add_argument('--token-file', type=Path, help='Existing mode: file containing that backend’s session token')
    p.add_argument('--dry-run', action='store_true', help='Validate and describe the installation without writing or starting anything')
    p.add_argument('--no-start', action='store_true', help='Install files only; do not call daemon-reload or enable services')
    return p


def plan(args, root, units):
    root = root.resolve()
    data = (args.data_dir or root / 'data').expanduser().resolve()
    if not (root / 'dist/index.html').is_file():
        fail('Build the app before installing services (npm ci && npm run build).')
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,63}', args.profile):
        fail('Invalid Hermes profile name.')
    if not clean(args.identity).strip():
        fail('A Tailscale user login is required.')
    app_origin = origin(args.origin)
    for port in (args.app_port, args.backend_port):
        if not 1 <= port <= 65535:
            fail('Ports must be from 1 to 65535.')
    node = executable(args.node, 'node')
    version = subprocess.run([node, '--version'], check=True, capture_output=True, text=True).stdout.strip()
    if not re.match(r'^v(?:2[4-9]|[3-9]\d|\d{3,})\.', version):
        fail('Node.js 24 or newer is required.')
    managed = args.mode == 'managed'
    if managed and (args.backend_url or args.token_file):
        fail('--backend-url and --token-file are for existing mode only.')
    files = {}
    service_ports = {'herts.service': args.app_port}
    backend_after = ''
    if managed:
        if args.app_port == args.backend_port:
            fail('The app and backend need different ports.')
        hermes = executable(args.hermes_bin, 'hermes')
        home = args.hermes_home.expanduser().resolve()
        profile_home = home if args.profile == 'default' else home / 'profiles' / args.profile
        if not (profile_home / 'config.yaml').is_file():
            fail('Configure the selected Hermes profile first; its config.yaml was not found.')
        token_file = data / 'backend-token'
        if token_file.exists():
            if token_file.is_symlink() or token_file.stat().st_mode & 0o077:
                fail('The managed backend token must be a private regular file (chmod 600).')
            token = token_file.read_text().strip()
            if not token or re.search(r'\s', token):
                fail('The existing backend token is invalid; it has not been replaced.')
        else:
            token = secrets.token_urlsafe(48)
            files[token_file] = token + '\n'
        backend_url = f'http://127.0.0.1:{args.backend_port}'
        files[data / 'backend.env'] = ''.join(f'{key}={env_quote(value)}\n' for key, value in {
            'HERMES_HOME': home, 'HERMES_DESKTOP': '1', 'HERMES_DASHBOARD_SESSION_TOKEN': token,
        }.items())
        files[units / 'herts-backend.service'] = render(root, 'herts-backend.service.in', {'@HOME@': unit_directory(home), '@ENV@': unit_quote(data / 'backend.env'), '@PATH@': unit_quote('PATH=' + os.environ.get('PATH', '/usr/local/bin:/usr/bin:/bin')), '@COMMAND@': ' '.join(unit_quote(v, True) for v in [hermes, '--profile', args.profile, 'serve', '--isolated', '--host', '127.0.0.1', '--port', str(args.backend_port)])})
        backend_after = ' herts-backend.service'
        service_ports['herts-backend.service'] = args.backend_port
    else:
        if not args.backend_url or not args.token_file:
            fail('Existing mode requires --backend-url and --token-file.')
        backend_url = origin(args.backend_url, backend=True)
        token_file = args.token_file.expanduser().resolve()
        if not token_file.is_file() or not token_file.read_text().strip():
            fail('The existing backend token file must exist and be nonempty.')
        if token_file.stat().st_mode & 0o077:
            fail('Protect the token file with chmod 600 before installing.')
        if re.search(r'\s', token_file.read_text().strip()):
            fail('The backend token must be a single value.')
    files[data / 'app.env'] = ''.join(f'{key}={env_quote(value)}\n' for key, value in {
        'HERTS_PLUGINS_DIR': (args.plugins_dir or root / 'plugins').expanduser().resolve(), 'HERTS_DATA_DIR': data, 'HERTS_ORIGIN': app_origin, 'HERTS_IDENTITY': args.identity,
        'HERTS_PORT': args.app_port, 'HERMES_BASE_URL': backend_url,
        'HERMES_TOKEN_FILE': token_file, 'HERMES_PROFILE': args.profile,
    }.items())
    files[units / 'herts.service'] = render(root, 'herts.service.in', {'@AFTER@': backend_after, '@ROOT@': unit_directory(root), '@ENV@': unit_quote(data / 'app.env'), '@NODE@': unit_quote(node, True)})
    # Compare every destination before any write. Edited settings are never overwritten.
    for path, content in files.items():
        if path.exists() and path.parent == data and path.stat().st_mode & 0o077:
            fail(f'Protect {path.name} with chmod 600 before installing.')
        if path.exists() and (path.is_symlink() or path.read_text() != content):
            fail(f'Existing {path.name} differs from this installation. Nothing was overwritten. Keep the existing setup or review the change manually.')
    for name, port in service_ports.items():
        running = active(name)
        if running and not (units / name).is_file():
            fail(f'{name} is active but is not owned by this installation.')
        if not running:
            free_port(port)
    return files, list(reversed(service_ports)), data


def install(args, root, units):
    files, names, data = plan(args, root, units)
    if args.dry_run:
        print(f'Validated {args.mode} installation: {len(files)} files, {len(names)} services. Dry run: no files changed and no services started.')
        return
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    if data.stat().st_mode & 0o077:
        fail('The data directory must be private. Set its permissions to 700 before installing.')
    units.mkdir(parents=True, exist_ok=True)
    for path, content in files.items():
        if not path.exists():
            with path.open('x') as out:
                out.write(content)
            path.chmod(0o600)
    if not args.no_start:
        subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
        subprocess.run(['systemctl', '--user', 'enable', '--now', *names], check=True)
    print('Herts installation complete. Existing configuration and credentials were retained; no active service was restarted.')


if __name__ == '__main__':
    os.umask(0o077)
    try:
        install(parser().parse_args(), Path(__file__).resolve().parents[1], Path.home() / '.config/systemd/user')
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        # Never print subprocess output or configuration values (which may contain credentials).
        raise SystemExit(str(error) if isinstance(error, ValueError) else 'Installation failed. Check paths, permissions and the user systemd session.') from None
