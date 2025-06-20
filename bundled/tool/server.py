# Adapted from https://github.com/astral-sh/ruff-lsp/blob/main/ruff_lsp/server.py
# License:
# MIT License

# Copyright (c) 2022 Charles Marsh

# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:

# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.

# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

from __future__ import annotations

import logging
import logging.config
import os
import pathlib
import site
import sys

BUNDLE_DIR = pathlib.Path(__file__).parent.parent
logger = logging.getLogger(__name__)


def update_sys_path(path_to_add: str) -> None:
    """Add given path to `sys.path`."""
    if os.path.isdir(path_to_add):
        # The `site` module adds the directory at the end, if not yet present; we want
        # it to be at the beginning, so that it takes precedence over any other
        # installed versions.
        sys.path.insert(0, path_to_add)

        # Allow development versions of libraries to be imported.
        site.addsitedir(path_to_add)


def main():
    from logfire_lsp import server

    logging.config.dictConfig(
        {
            'version': 1,
            'disable_existing_loggers': False,
            'formatters': {'simple': {'format': '%(asctime)s %(levelname)-4s %(message)s'}},
            'handlers': {
                'stderr': {
                    'class': 'logging.StreamHandler',
                    'formatter': 'simple',
                },
            },
            'root': {'level': 'INFO', 'handlers': ['stderr']},
            'loggers': {
                # Don't repeat every message
                'pygls.protocol': {
                    'level': 'WARN',
                    'handlers': ['stderr'],
                    'propagate': False,
                },
            },
        }
    )

    server.start()


# Start the server.
if __name__ == '__main__':
    # Ensure that we can import LSP libraries, and other bundled libraries.
    update_sys_path(os.fspath(BUNDLE_DIR / 'libs'))
    main()
