#!/usr/bin/env python3
"""Operate only the pre-provisioned IWXA TEST VM; no forced shutdown."""
import argparse
import fcntl
import os
import stat
import subprocess
import time

VM = 'iwxa-t4-test'
LOCK = '/run/iwxa-t4-test.lifecycle.lock'


def virsh(*args):
    result = subprocess.run(['/usr/bin/virsh', '--connect', 'qemu:///system', *args],
                            check=True, capture_output=True, text=True, timeout=15,
                            env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
    return result.stdout.strip()


def control(action, call=virsh, sleep=time.sleep, clock=time.monotonic, timeout=120):
    if action not in ('status', 'start', 'stop'):
        raise ValueError('Unknown action')
    state = call('domstate', VM)
    if action in ('status', 'start'):
        values = [line.split(':', 1)[1].strip() for line in call('dominfo', VM).splitlines()
                  if line.startswith('Autostart:')]
        if len(values) != 1 or values[0] not in ('enable', 'disable'):
            raise RuntimeError('Cannot verify VM autostart')
        if action == 'status':
            return f'{state}; autostart={values[0]}'
        if values[0] != 'disable':
            raise RuntimeError('Disable VM autostart explicitly before using the lab')
        if state == 'running':
            return state
        if state != 'shut off':
            raise RuntimeError(f'Unexpected VM state: {state}')
        call('start', VM)
        state = call('domstate', VM)
        if state != 'running':
            raise RuntimeError(f'Start not confirmed: {state}')
        return state
    if state == 'shut off':
        return state
    if state == 'running':
        call('shutdown', VM, '--mode', 'acpi')
    elif state != 'in shutdown':
        raise RuntimeError(f'Unexpected VM state: {state}; investigate manually')
    deadline = clock() + timeout
    while True:
        state = call('domstate', VM)
        if state == 'shut off':
            return state
        if state not in ('running', 'in shutdown'):
            raise RuntimeError(f'Shutdown not confirmed: {state}')
        if clock() >= deadline:
            raise RuntimeError('Graceful shutdown timed out; VM remains untouched')
        sleep(min(1, max(0, deadline - clock())))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'start', 'stop'])
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.exit(1, 'Run locally as an authorized sudo administrator.\n')
    try:
        fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'r+') as lock:
            info = os.fstat(lock.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
                raise RuntimeError('Unsafe lifecycle lock')
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(control(args.action))
    except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
        parser.exit(1, f'Lab operation failed: {exc}\n')


if __name__ == '__main__':
    main()
