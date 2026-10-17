# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""Runs from a checkout: the example package sits one folder up."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
