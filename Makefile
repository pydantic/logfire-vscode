.PHONY: setup  ## Setup the environment
setup:
	uv pip sync --require-hashes ./requirements.txt --target ./bundled/libs --python 3.12

.PHONY: lock  ## Lock the project dependencies
lock:
	uv pip compile --python-version 3.9 --generate-hashes -o ./requirements.txt ./pyproject.toml
