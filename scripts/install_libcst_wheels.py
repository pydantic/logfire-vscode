import argparse
import hashlib
import json
import sys
import zipfile
from io import BytesIO
from pathlib import Path

import requests
from _common import ROOT, VSCODE_PLATFORM_TAGS, path


class CommandNamespace(argparse.Namespace):
    code_target: str
    libcst_versions: Path
    output: Path


def install_libcst_wheels(code_target: str, libcst_versions: Path, output: Path) -> None:
    libcst_versions_data = json.loads(libcst_versions.read_bytes())[code_target]

    for wheel_info in libcst_versions_data:
        print(f'Downloading {wheel_info["url"]}')
        fetched_wheel = requests.get(wheel_info['url'])
        if (dl_hash := hashlib.new('sha256', fetched_wheel.content).hexdigest()) != wheel_info['sha256']:
            print(f'SHA256 mismatch: expected {wheel_info["sha256"]}, got {dl_hash}')
            raise SystemExit

        with zipfile.ZipFile(BytesIO(fetched_wheel.content), 'r') as wheel_file:
            for zip_info in wheel_file.infolist():
                print(f'    Extrating {zip_info.filename}')
                wheel_file.extract(zip_info.filename, output)


if __name__ == '__main__':
    color = {'color': True} if sys.version_info >= (3, 14) else {}

    parser = argparse.ArgumentParser(
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
        description='Unpack the LibCST wheels for a specific VSCode target.',
        **color,
    )
    parser.add_argument(
        '-t',
        '--code-target',
        help='VSCode platform target.',
        choices=VSCODE_PLATFORM_TAGS,
        required=True,
    )
    parser.add_argument(
        '--libcst-versions',
        type=path(check_is_file=True),
        help='LibCST versions file.',
        default=ROOT / 'libcst_versions.json',
    )
    parser.add_argument(
        '-o',
        '--output',
        type=path(check_is_dir=True),
        help='Path to the JSON output file.',
        default=ROOT / 'bundled' / 'libs',
    )

    args = parser.parse_args(namespace=CommandNamespace())

    install_libcst_wheels(args.code_target, args.libcst_versions, args.output)
