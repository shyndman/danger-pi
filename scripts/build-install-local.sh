#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
UTILS_PACKAGE_JSON="$REPO_ROOT/packages/utils/package.json"
DIST_BINARY="$REPO_ROOT/packages/coding-agent/dist/omp"
INSTALL_DIR="${PI_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
	Linux)
		PLATFORM="linux"
		;;
	Darwin)
		PLATFORM="darwin"
		;;
	*)
		echo "Unsupported OS: $(uname -s)" >&2
		exit 1
		;;
esac

case "$(uname -m)" in
	x86_64|amd64)
		ARCH="x64"
		;;
	arm64|aarch64)
		ARCH="arm64"
		;;
	*)
		echo "Unsupported architecture: $(uname -m)" >&2
		exit 1
		;;
esac

NATIVE_ADDON="$REPO_ROOT/packages/natives/native/pi_natives.${PLATFORM}-${ARCH}.node"
TMP_BACKUP="$(mktemp "${TMPDIR:-/tmp}/omp-utils-package.XXXXXX")"

install_file_atomic() {
	local source_path="$1"
	local destination_path="$2"
	local temp_path="${destination_path}.tmp.$$"

	cp "$source_path" "$temp_path"
	mv -f "$temp_path" "$destination_path"
}

cleanup() {
	local exit_code=$?

	if [ -f "$TMP_BACKUP" ]; then
		cp "$TMP_BACKUP" "$UTILS_PACKAGE_JSON"
		rm -f "$TMP_BACKUP"
	fi

	exit "$exit_code"
}
trap cleanup EXIT INT TERM HUP

cp "$UTILS_PACKAGE_JSON" "$TMP_BACKUP"

echo "Patching version in packages/utils/package.json to +local-{yymmdd-hhmmss}"
LOCAL_SUFFIX="local-$(date +%y%m%d-%H%M%S)"
UTILS_PACKAGE_JSON="$UTILS_PACKAGE_JSON" LOCAL_SUFFIX="$LOCAL_SUFFIX" bun -e '
const file = Bun.env.UTILS_PACKAGE_JSON;
if (!file) throw new Error("UTILS_PACKAGE_JSON not set");

const packageJson = await Bun.file(file).json() as Record<string, unknown>;
const version = String(packageJson.version ?? "");
if (!version) throw new Error("packages/utils/package.json missing version");
const baseVersion = version.split("+")[0];

const suffix = Bun.env.LOCAL_SUFFIX;
packageJson.version = `${baseVersion}+${suffix}`;

await Bun.write(file, `${JSON.stringify(packageJson, null, "\t")}\n`);
'

echo "Building binary"
(
	cd "$REPO_ROOT"
	bun --cwd=packages/coding-agent run build:binary
)

if [ ! -f "$DIST_BINARY" ]; then
	echo "Built binary not found: $DIST_BINARY" >&2
	exit 1
fi

if [ ! -f "$NATIVE_ADDON" ]; then
	echo "Native addon not found: $NATIVE_ADDON" >&2
	exit 1
fi

mkdir -p "$INSTALL_DIR"
install_file_atomic "$DIST_BINARY" "$INSTALL_DIR/omp"
chmod +x "$INSTALL_DIR/omp"
install_file_atomic "$NATIVE_ADDON" "$INSTALL_DIR/$(basename "$NATIVE_ADDON")"

echo "Installed binary: $INSTALL_DIR/omp"
echo "Installed native addon: $INSTALL_DIR/$(basename "$NATIVE_ADDON")"
