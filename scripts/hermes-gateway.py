"""Read gateway identity and obtain private connection tickets."""
import json
import os
import sys
from contextlib import redirect_stdout
from dataclasses import asdict
from pathlib import Path

with redirect_stdout(sys.stderr):
    from hermes_cli.gateway_runtime import discover_gateway_endpoint
    from hermes_cli.gateway_client import _session_ticket

root = Path(os.environ['HERMES_HOME']).resolve()
for line in iter(lambda: sys.stdin.buffer.readline(65537), b''):
    if len(line) > 65536:
        break
    request = {}
    try:
        request = json.loads(line)
        profile = request['profile']
        import re
        if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,63}', profile):
            raise ValueError('invalid_profile')
        home = root if profile == 'default' else (root / 'profiles' / profile).resolve()
        with redirect_stdout(sys.stderr):
            found = discover_gateway_endpoint(home, timeout=5)
            if found.state != 'ready' or found.endpoint is None:
                raise ValueError('gateway_unavailable')
            endpoint = found.endpoint
            if endpoint.profile_id != str(home):
                raise ValueError('profile_mismatch')
            result = {'endpoint': asdict(endpoint)}
            result['endpoint']['capabilities'] = sorted(endpoint.capabilities)
            if request.get('purpose'):
                purpose = request['purpose']
                if purpose not in ('interactive', 'native-http'):
                    raise ValueError('invalid_purpose')
                result['ticket'] = _session_ticket(home, endpoint, purpose=purpose,
                                                  scope='host' if purpose == 'interactive' else None)
        reply = {'id': request['id'], 'result': result}
    except Exception:
        reply = {'id': request.get('id'), 'error': 'Gateway access failed. Check the Hermes service, profile, and installation.'}
    print(json.dumps(reply), flush=True)
