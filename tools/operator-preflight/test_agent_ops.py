"""Static contract for operator entry points. Not an execution/compliance proof."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]

class AgentOperatingStandardTests(unittest.TestCase):
    def read(self, relative):
        file = ROOT / relative
        self.assertTrue(file.is_file(), f"missing policy/tool: {relative}")
        return file.read_text(encoding="utf-8")

    def test_entrypoints(self):
        a = self.read("AGENTS.md")
        c = self.read("CLAUDE.md")
        for name in (
            "docs/agent-operations/OPERATING-STANDARD.md",
            "docs/agent-operations/GTA-PC-PLAYBOOK.md",
            "docs/agent-operations/PR-LESSONS-20261023.md",
        ):
            self.assertIn(name, a)
            self.read(name)
        self.assertIn("@AGENTS.md", c)
        self.assertIn("after context compaction", c.lower())

    def test_playbook_and_pr_template(self):
        a = self.read("docs/agent-operations/OPERATING-STANDARD.md")
        g = self.read("docs/agent-operations/GTA-PC-PLAYBOOK.md")
        t = self.read(".github/PULL_REQUEST_TEMPLATE.md")
        for term in ("UNKNOWN", "reconcile", "hash", "9/9", "GUI"):
            self.assertIn(term.lower(), (a + g).lower())
        for term in ("Test-GpuPowerLimit.ps1", "renodx-dlss.addon64", "controller.py"):
            self.assertIn(term, g)
        for term in ("AGENTS.md", "runtime identity", "gameplay/world", "rollback"):
            self.assertIn(term, t)

    def test_gpu_preflight_is_read_only(self):
        s = self.read("tools/operator-preflight/Test-GpuPowerLimit.ps1")
        for term in ("nvidia-smi.exe", "PowerLimit", "settingsChanged = $false",
                     "MISMATCH", "UNKNOWN", "No preset action needed"):
            self.assertIn(term, s)
        for forbidden in ("Start-Process", "Afterburner.exe", "Set-Gpu",
                          "MSIAfterburner.exe", "Apply-Profile"):
            self.assertNotIn(forbidden, s)

if __name__ == "__main__":
    unittest.main()
