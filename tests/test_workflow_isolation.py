"""Check the actual workflow's source isolation and final failure reporting."""
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[1] / '.github/workflows/update-and-deploy.yml'


class WorkflowIsolationTests(unittest.TestCase):
    def test_source_failures_do_not_gate_commit_or_pages(self):
        # Inspect step blocks without adding a YAML dependency to the stdlib suite.
        blocks = re.split(r'^      - name: ', WORKFLOW.read_text(), flags=re.M)[1:]
        steps = {}
        for index, block in enumerate(blocks):
            match = re.search(r'^        id: (\w+)$', block, re.M)
            if match:
                steps[match[1]] = (index, block)
        for source in ('prices', 'fx', 'tariffs'):
            self.assertIn('        continue-on-error: true\n', steps[source][1])
            self.assertLess(steps[source][0], steps['commit'][0])
        self.assertLess(steps['commit'][0], steps['pages'][0])
        for step in ('prices', 'fx', 'tariffs', 'commit', 'pages'):
            self.assertNotRegex(steps[step][1], r'(?m)^        if:')
        self.assertIn('python scripts/publish_pages.py', steps['pages'][1])
        report = blocks[-1]
        self.assertIn('if: always()', report)
        for step in ('tests', 'prices', 'fx', 'tariffs', 'commit', 'pages'):
            self.assertIn('${{ steps.' + step + '.outcome }}', report)
        script = report.split('        run: |\n', 1)[1]
        script = '\n'.join(line[10:] for line in script.splitlines())
        with tempfile.TemporaryDirectory() as temp:
            for failed in (None, 'PRICES', 'FX', 'TARIFFS'):
                env = dict(os.environ, GITHUB_STEP_SUMMARY=str(Path(temp) / 'summary'))
                env.update({step: 'failure' if step == failed else 'success'
                            for step in ('TESTS', 'PRICES', 'FX', 'TARIFFS', 'COMMIT', 'PAGES')})
                result = subprocess.run(['bash', '-e', '-c', script], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, int(failed is not None), result.stderr)
                if failed:
                    self.assertIn(f'::error::{failed}', result.stdout)
