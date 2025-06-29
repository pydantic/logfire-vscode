import argparse
import json
import sys
from pathlib import Path
from typing import TypedDict

import requests
import requirements
from _common import ROOT, VSCODE_PLATFORM_TAGS, path
from wheel_filename import ParsedWheelFilename, parse_wheel_filename


class CommandNamespace(argparse.Namespace):
    requirements_txt: Path
    output: Path


class Wheel(TypedDict):
    sha256: str
    url: str
    parsed_wheelname: ParsedWheelFilename


PYTHON_TAGS = ['cp39', 'cp310', 'cp311', 'cp312', 'cp313', 'cp313t']


def build_libcst_json(requirements_txt: Path, output: Path) -> None:
    json_data: dict[str, object] = {}

    with requirements_txt.open('rt') as fd:
        libcst_req = next((req for req in requirements.parse(fd) if req.name == 'libcst'), None)
        if libcst_req is None:
            print('No requirement found for LibCST')
            raise SystemExit

    libcst_specs = libcst_req.specs
    if not len(libcst_specs) == 1 or libcst_specs[0][0] != '==':
        print(f"Expected a single '==' version specification, got {libcst_specs}")
        raise SystemExit

    libcst_version = libcst_specs[0][1]

    package_data = requests.get(f'https://pypi.org/pypi/libcst/{libcst_version}/json')
    api_urls = package_data.json()['urls']
    wheels: list[Wheel] = [
        {
            'sha256': url['digests']['sha256'],
            'url': url['url'],
            'parsed_wheelname': parse_wheel_filename(url['filename']),
        }
        for url in api_urls
        if url['packagetype'] == 'bdist_wheel'
    ]

    # Fetching necessary wheels for each VSCode platform tag, and matching with the wheel platform tags:
    # see https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions,
    # see https://packaging.python.org/en/latest/specifications/platform-compatibility-tags/#platform-tag.

    # 1. win32-x64:

    json_data['win32-x64'] = [
        {'url': wheel['url'], 'sha256': wheel['sha256']}
        for wheel in wheels
        if 'win_amd64' in wheel['parsed_wheelname'].platform_tags
        and any(tag in PYTHON_TAGS for tag in wheel['parsed_wheelname'].python_tags)
    ]

    # 2. win32-arm64:

    json_data['win32-arm64'] = [
        {'url': wheel['url'], 'sha256': wheel['sha256']}
        for wheel in wheels
        if 'win_arm64' in wheel['parsed_wheelname'].platform_tags
        if any(tag in PYTHON_TAGS for tag in wheel['parsed_wheelname'].python_tags)
    ]

    # 3. linux-x64:

    json_data['linux-x64'] = [
        {'url': wheel['url'], 'sha256': wheel['sha256']}
        for wheel in wheels
        if any(
            tag.startswith('manylinux') and tag.endswith('x86_64') for tag in wheel['parsed_wheelname'].platform_tags
        )
        if any(tag in PYTHON_TAGS for tag in wheel['parsed_wheelname'].python_tags)
    ]

    # 4. linux-arm64:

    json_data['linux-arm64'] = [
        {'url': wheel['url'], 'sha256': wheel['sha256']}
        for wheel in wheels
        if any(
            tag.startswith('manylinux') and tag.endswith('aarch64') for tag in wheel['parsed_wheelname'].platform_tags
        )
        if any(tag in PYTHON_TAGS for tag in wheel['parsed_wheelname'].python_tags)
    ]

    # 5. linux-armhf:

    json_data['linux-armhf'] = [
        {'url': wheel['url'], 'sha256': wheel['sha256']}
        for wheel in wheels
        if any(
            tag.startswith('manylinux') and tag.endswith('armv7l') for tag in wheel['parsed_wheelname'].platform_tags
        )
        if any(tag in PYTHON_TAGS for tag in wheel['parsed_wheelname'].python_tags)
    ]

    # 6. linux-armhf:

    json_data['alpine-x64'] = [
        {'url': wheel['url'], 'sha256': wheel['sha256']}
        for wheel in wheels
        if any(
            tag.startswith('musllinux') and tag.endswith('x86_64') for tag in wheel['parsed_wheelname'].platform_tags
        )
        if any(tag in PYTHON_TAGS for tag in wheel['parsed_wheelname'].python_tags)
    ]

    # 7. alpine-arm64:

    json_data['alpine-arm64'] = [
        {'url': wheel['url'], 'sha256': wheel['sha256']}
        for wheel in wheels
        if any(
            tag.startswith('musllinux') and tag.endswith('aarch64') for tag in wheel['parsed_wheelname'].platform_tags
        )
        if any(tag in PYTHON_TAGS for tag in wheel['parsed_wheelname'].python_tags)
    ]

    # 8. darwin-x64:

    json_data['darwin-x64'] = [
        {'url': wheel['url'], 'sha256': wheel['sha256']}
        for wheel in wheels
        if any(tag.startswith('macosx') and tag.endswith('x86_64') for tag in wheel['parsed_wheelname'].platform_tags)
        if any(tag in PYTHON_TAGS for tag in wheel['parsed_wheelname'].python_tags)
    ]

    # 9. darwin-arm64:

    json_data['darwin-arm64'] = [
        {'url': wheel['url'], 'sha256': wheel['sha256']}
        for wheel in wheels
        if any(tag.startswith('macosx') and tag.endswith('arm64') for tag in wheel['parsed_wheelname'].platform_tags)
        if any(tag in PYTHON_TAGS for tag in wheel['parsed_wheelname'].python_tags)
    ]

    if missing := set(VSCODE_PLATFORM_TAGS).difference(json_data):
        print(f'Missing VSCode targets in JSON data: {missing}')
        raise SystemExit

    output.write_text(json.dumps(json_data, indent=4))


if __name__ == '__main__':
    color = {'color': True} if sys.version_info >= (3, 14) else {}

    parser = argparse.ArgumentParser(
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
        description="Generate the 'libcst_wheels.json' file.",
        **color,
    )
    parser.add_argument(
        '-r',
        '--requirements-txt',
        type=path(check_is_file=True),
        help="Path to the 'requirements.txt' file.",
        default=ROOT / 'requirements.txt',
    )
    parser.add_argument(
        '-o',
        '--output',
        type=path(),
        help='Path to the JSON output file.',
        default=ROOT / 'libcst_versions.json',
    )

    args = parser.parse_args(namespace=CommandNamespace())

    build_libcst_json(args.requirements_txt, args.output)
