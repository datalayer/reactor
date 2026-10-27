# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""The one version both halves are, as the installed distribution reports it.

Written once, in ``frontend/package.json``; ``pyproject.toml`` reads it from
there when the wheel is built, and this reads it back from what was installed.
"""

from importlib.metadata import version

__version__ = version("reactor-extension-__NAME__")
