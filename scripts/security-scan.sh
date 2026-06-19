#!/usr/bin/env bash
#
# SoundWave — local security scan runner
# Operationalizes the tooling from SECURITY_ASSESSMENT.md §8 in one reproducible command.
#
# Runs (when the tool is available):
#   - hadolint    Dockerfile lint
#   - gitleaks    secret scan (git history + working tree), redacted
#   - trivy config repo IaC/Dockerfile misconfiguration scan
#   - trivy fs    filesystem vuln + secret scan (covers Python deps in requirements.txt)
#   - pip-audit   Python dependency CVEs (robust invocation — fixes the broken-shim issue)
#   - syft        CycloneDX SBOM
#   - trivy image / grype   image vuln scan (only when an image is available)
#
# Outputs JSON/SBOM reports to ./security-reports (gitignored).
#
# Exit status:
#   0  no fixable CRITICAL/HIGH findings (or running in --report-only mode)
#   1  fixable CRITICAL/HIGH vulnerabilities found (gate)
#   2  a required tool was missing and could not be skipped
#
# Usage:
#   scripts/security-scan.sh [--image <ref>] [--report-only] [--no-image] [--strict]
#
#   --image <ref>   Image to scan (default: ghcr.io/aiulian25/soundwave:main if pullable,
#                   else skipped). Use "local" build tag, e.g. soundwave:dev.
#   --report-only   Never fail; just produce reports and a summary.
#   --no-image      Skip the image scan entirely (code/dep/config only).
#   --strict        Gate on HIGH as well as CRITICAL, including unfixed.
#
set -uo pipefail

# --- locate repo root regardless of where the script is called from ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

OUT_DIR="${ROOT_DIR}/security-reports"
mkdir -p "${OUT_DIR}"

IMAGE_REF="ghcr.io/aiulian25/soundwave:main"
REPORT_ONLY=0
SCAN_IMAGE=1
STRICT=0
GATE_SEVERITY="CRITICAL,HIGH"

while [ $# -gt 0 ]; do
  case "$1" in
    --image)       IMAGE_REF="$2"; shift 2 ;;
    --report-only) REPORT_ONLY=1; shift ;;
    --no-image)    SCAN_IMAGE=0; shift ;;
    --strict)      STRICT=1; shift ;;
    -h|--help)     grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

# Trivy gating flags: by default only fixable issues fail the build (achievable gate);
# --strict also fails on unfixed.
TRIVY_GATE_FLAGS=(--severity "${GATE_SEVERITY}" --exit-code 1)
if [ "${STRICT}" -eq 0 ]; then
  TRIVY_GATE_FLAGS+=(--ignore-unfixed)
fi

# Exclude local dev artifacts from filesystem scans. Trivy still analyzes the
# committed lockfiles/manifests (requirements.txt, package-lock.json) for deps —
# we only skip the *installed* copies (venv/node_modules) and build output, which
# are not part of the shipped image and produce noise/false positives.
TRIVY_SKIP_DIRS=".venv,venv,frontend/node_modules,node_modules,frontend/dist,staticfiles,backend/staticfiles,audio,cache,data,es,redis,security-reports,.git"
TRIVY_FS_FLAGS=(--skip-dirs "${TRIVY_SKIP_DIRS}")

GATE_FAILED=0
RAN_ANY=0

c_bold=$'\033[1m'; c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_rst=$'\033[0m'
have() { command -v "$1" >/dev/null 2>&1; }
section() { printf "\n%s== %s ==%s\n" "${c_bold}" "$1" "${c_rst}"; }
skip()    { printf "%s-- skipped: %s (%s)%s\n" "${c_yel}" "$1" "$2" "${c_rst}"; }
ok()      { printf "%s   ok: %s%s\n" "${c_grn}" "$1" "${c_rst}"; }
fail()    { printf "%s   FAIL: %s%s\n" "${c_red}" "$1" "${c_rst}"; GATE_FAILED=1; }

# ---------------------------------------------------------------------------
section "hadolint — Dockerfile lint"
if have hadolint; then
  RAN_ANY=1
  hadolint Dockerfile | tee "${OUT_DIR}/hadolint.txt" || true
  ok "report: security-reports/hadolint.txt"
else
  skip "hadolint" "install: https://github.com/hadolint/hadolint"
fi

# ---------------------------------------------------------------------------
section "gitleaks — secret scan (redacted)"
if have gitleaks; then
  RAN_ANY=1
  CFG=(); [ -f .gitleaks.toml ] && CFG=(--config .gitleaks.toml)
  if gitleaks detect --no-banner --redact "${CFG[@]}" \
        --report-format json --report-path "${OUT_DIR}/gitleaks.json"; then
    ok "no secrets found (report: security-reports/gitleaks.json)"
  else
    fail "gitleaks found potential secrets — review security-reports/gitleaks.json"
  fi
else
  skip "gitleaks" "install: https://github.com/gitleaks/gitleaks"
fi

# ---------------------------------------------------------------------------
section "trivy config — IaC / Dockerfile misconfig"
if have trivy; then
  RAN_ANY=1
  trivy config --quiet -f json -o "${OUT_DIR}/trivy-config.json" . || true
  trivy config --quiet --severity HIGH,CRITICAL . || true
  ok "report: security-reports/trivy-config.json"
else
  skip "trivy" "install: https://aquasecurity.github.io/trivy"
fi

# ---------------------------------------------------------------------------
section "trivy fs — filesystem vuln + secret (covers Python deps)"
if have trivy; then
  RAN_ANY=1
  trivy fs --quiet --scanners vuln,secret "${TRIVY_FS_FLAGS[@]}" -f json -o "${OUT_DIR}/trivy-fs.json" . || true
  if trivy fs --quiet --scanners vuln "${TRIVY_FS_FLAGS[@]}" "${TRIVY_GATE_FLAGS[@]}" .; then
    ok "no gating fs vulnerabilities"
  else
    fail "trivy fs found gating CVEs (severity ${GATE_SEVERITY})"
  fi
else
  skip "trivy fs" "trivy not installed"
fi

# ---------------------------------------------------------------------------
section "pip-audit — Python dependency CVEs"
PIP_AUDIT=""
# Prefer a working module import over the `pip-audit` shim (the venv shim can be
# broken — ModuleNotFoundError — as documented in SECURITY_ASSESSMENT.md §8).
if python3 -c "import pip_audit" 2>/dev/null; then PIP_AUDIT="python3 -m pip_audit"
elif have pip-audit && pip-audit --version >/dev/null 2>&1; then PIP_AUDIT="pip-audit"
elif python3 -m pip install --quiet --disable-pip-version-check pip-audit 2>/dev/null \
     && python3 -c "import pip_audit" 2>/dev/null; then PIP_AUDIT="python3 -m pip_audit"
fi
if [ -n "${PIP_AUDIT}" ]; then
  RAN_ANY=1
  # Report (never the sole gate; trivy fs already covers these and won't false-negative).
  ${PIP_AUDIT} -r backend/requirements.txt -f json > "${OUT_DIR}/pip-audit.json" 2>/dev/null || true
  ${PIP_AUDIT} -r backend/requirements.txt || true
  ok "report: security-reports/pip-audit.json"
else
  skip "pip-audit" "could not import or install pip_audit"
fi

# ---------------------------------------------------------------------------
section "syft — CycloneDX SBOM (source tree)"
if have syft; then
  RAN_ANY=1
  syft scan "dir:${ROOT_DIR}" -o "cyclonedx-json=${OUT_DIR}/sbom.source.cdx.json" -q || true
  ok "SBOM: security-reports/sbom.source.cdx.json"
else
  skip "syft" "install: https://github.com/anchore/syft"
fi

# ---------------------------------------------------------------------------
if [ "${SCAN_IMAGE}" -eq 1 ]; then
  IMAGE_AVAILABLE=0
  if have docker; then
    if docker image inspect "${IMAGE_REF}" >/dev/null 2>&1; then
      IMAGE_AVAILABLE=1
    elif docker pull "${IMAGE_REF}" >/dev/null 2>&1; then
      IMAGE_AVAILABLE=1
    fi
  fi

  section "trivy image — ${IMAGE_REF}"
  if have trivy && [ "${IMAGE_AVAILABLE}" -eq 1 ]; then
    RAN_ANY=1
    trivy image --quiet --scanners vuln,secret,misconfig \
      -f json -o "${OUT_DIR}/trivy-image.json" "${IMAGE_REF}" || true
    if trivy image --quiet --scanners vuln "${TRIVY_GATE_FLAGS[@]}" "${IMAGE_REF}"; then
      ok "no gating image vulnerabilities"
    else
      fail "trivy image found gating CVEs (severity ${GATE_SEVERITY})"
    fi
  else
    skip "trivy image" "image ${IMAGE_REF} not available locally/pullable"
  fi

  section "grype — ${IMAGE_REF}"
  if have grype && [ "${IMAGE_AVAILABLE}" -eq 1 ]; then
    RAN_ANY=1
    grype "${IMAGE_REF}" -o json > "${OUT_DIR}/grype-image.json" 2>/dev/null || true
    ok "report: security-reports/grype-image.json"
  else
    skip "grype" "grype missing or image unavailable"
  fi

  section "syft — image SBOM"
  if have syft && [ "${IMAGE_AVAILABLE}" -eq 1 ]; then
    syft scan "docker:${IMAGE_REF}" -o "cyclonedx-json=${OUT_DIR}/sbom.image.cdx.json" -q || true
    ok "SBOM: security-reports/sbom.image.cdx.json"
  fi
fi

# ---------------------------------------------------------------------------
section "summary"
if [ "${RAN_ANY}" -eq 0 ]; then
  printf "%sNo scanners were available. Install at least trivy + gitleaks.%s\n" "${c_red}" "${c_rst}"
  exit 2
fi
printf "Reports written to: %s\n" "${OUT_DIR}"
if [ "${GATE_FAILED}" -eq 1 ] && [ "${REPORT_ONLY}" -eq 0 ]; then
  printf "%sSecurity gate: FAILED (fixable CRITICAL/HIGH present)%s\n" "${c_red}" "${c_rst}"
  exit 1
fi
printf "%sSecurity gate: PASSED%s\n" "${c_grn}" "${c_rst}"
exit 0
