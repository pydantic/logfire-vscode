from argparse import ArgumentTypeError
from collections.abc import Callable
from pathlib import Path
from typing import overload

ROOT = Path(__file__).parents[1]

VSCODE_PLATFORM_TAGS = [
    'win32-x64',
    'win32-arm64',
    'linux-x64',
    'linux-arm64',
    'linux-armhf',
    'linux-armhf',
    'alpine-x64',
    'alpine-arm64',
    'darwin-x64',
    'darwin-arm64',
]


@overload
def path() -> Callable[[str], Path]: ...


@overload
def path(*, check_is_file: bool) -> Callable[[str], Path]: ...


@overload
def path(*, check_is_dir: bool) -> Callable[[str], Path]: ...


def path(*, check_is_file: bool = False, check_is_dir: bool = False) -> Callable[[str], Path]:
    if check_is_file and check_is_dir:
        raise ValueError("'check_is_file' and 'check_is_dir' can't be provider together")

    def _file_path_inner(path_str: str) -> Path:
        path = Path(path_str)

        if not check_is_file or check_is_dir:
            return path
        if check_is_file and not path.is_file():
            raise ArgumentTypeError(f'{path_str!r} must be an existing file')
        if check_is_dir and not path.is_dir():
            raise ArgumentTypeError(f'{path_str!r} must be an existing directory')
        return path

    return _file_path_inner
