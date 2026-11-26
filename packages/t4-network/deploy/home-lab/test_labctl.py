import unittest
from labctl import VM, control


class Fake:
    def __init__(self, states, autostart='disable'):
        self.states = iter(states)
        self.autostart = autostart
        self.calls = []
        self.now = 0

    def call(self, *args):
        self.calls.append(args)
        assert args[1] == VM
        if args[0] == 'domstate':
            return next(self.states)
        if args[0] == 'dominfo':
            return 'Name: ' + VM + '\nAutostart: ' + self.autostart
        return ''

    def sleep(self, seconds):
        self.now += seconds

    def run(self, action):
        return control(action, self.call, self.sleep, lambda: self.now, timeout=2)


class LabControlTests(unittest.TestCase):
    def test_status(self):
        self.assertEqual(Fake(['shut off']).run('status'), 'shut off; autostart=disable')

    def test_start(self):
        f = Fake(['shut off', 'running'])
        self.assertEqual(f.run('start'), 'running')
        self.assertIn(('start', VM), f.calls)

    def test_already_running(self):
        f = Fake(['running'])
        self.assertEqual(f.run('start'), 'running')
        self.assertNotIn(('start', VM), f.calls)

    def test_autostart_rejected(self):
        f = Fake(['shut off'], 'enable')
        with self.assertRaises(RuntimeError):
            f.run('start')
        self.assertNotIn(('start', VM), f.calls)

    def test_unknown_autostart_rejected(self):
        with self.assertRaises(RuntimeError):
            Fake(['shut off'], 'unknown').run('start')

    def test_paused_rejected(self):
        for action in ('start', 'stop'):
            with self.subTest(action=action), self.assertRaises(RuntimeError):
                Fake(['paused']).run(action)

    def test_start_readback_required(self):
        with self.assertRaises(RuntimeError):
            Fake(['shut off', 'shut off']).run('start')

    def test_stop(self):
        f = Fake(['running', 'in shutdown', 'shut off'])
        self.assertEqual(f.run('stop'), 'shut off')
        self.assertIn(('shutdown', VM, '--mode', 'acpi'), f.calls)

    def test_already_off(self):
        f = Fake(['shut off'])
        self.assertEqual(f.run('stop'), 'shut off')
        self.assertEqual(f.calls, [('domstate', VM)])

    def test_in_shutdown(self):
        f = Fake(['in shutdown', 'shut off'])
        self.assertEqual(f.run('stop'), 'shut off')
        self.assertNotIn(('shutdown', VM, '--mode', 'acpi'), f.calls)

    def test_timeout_no_force(self):
        f = Fake(['running'] * 4)
        with self.assertRaisesRegex(RuntimeError, 'timed out'):
            f.run('stop')
        self.assertEqual({a[0] for a in f.calls}, {'domstate', 'shutdown'})

    def test_shutdown_crash_no_force(self):
        f = Fake(['running', 'crashed'])
        with self.assertRaises(RuntimeError):
            f.run('stop')
        self.assertEqual({a[0] for a in f.calls}, {'domstate', 'shutdown'})


if __name__ == '__main__':
    unittest.main()
