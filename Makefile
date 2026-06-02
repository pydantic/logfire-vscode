## Note: pyyaml is omitted because it requires binaries and is actually unused in our case.
##       libcst is omitted as we manually install binary wheels later
.PHONY: lock  ## Lock the project dependencies
lock:
	uv pip compile --no-cache --python-version 3.9 --generate-hashes --no-emit-package pyyaml --no-emit-package libcst -o ./requirements.txt ./pyproject.toml

.PHONY: setup-dev  ## Setup the dev environment
setup-dev:
	rm -rdf ./bundled/libs
	uv pip sync --require-hashes ./requirements.txt --target ./bundled/libs

.PHONY: setup  ## Setup the bundled libs for the provided VSCode platform target
setup:
	rm -rdf ./bundled/libs
	uv pip sync --require-hashes ./requirements.txt --target ./bundled/libs
	uv run scripts/install_libcst_wheels.py --code-target $(code-target)

.PHONY: build  ## Build the extension for the provided VSCode platform target
build:
	pnpm exec vsce package -o "./dist/logfire-$(code-target).vsix" --target $(code-target)
