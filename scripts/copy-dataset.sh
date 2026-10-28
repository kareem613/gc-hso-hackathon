#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SRC_ROOT="$(cd "${REPO_ROOT}/../hso-hackathon/datasets" && pwd)"
DEST_DIR="${REPO_ROOT}/datasets"

build_dataset_list() {
  if [[ -d "${SRC_ROOT}/core" ]]; then
    echo "core"
  fi
  find "${SRC_ROOT}" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
    | grep -v -E '^(core|templates)$' \
    | sort -r
}

mapfile -t DATASETS < <(build_dataset_list)

if [[ ${#DATASETS[@]} -eq 0 ]]; then
  echo "Error: No dataset folders found in ${SRC_ROOT}" >&2
  exit 1
fi

SELECTED=""

if [[ $# -ge 1 ]]; then
  SELECTED="$1"
  if [[ ! -d "${SRC_ROOT}/${SELECTED}" ]]; then
    echo "Error: Dataset '${SELECTED}' not found in ${SRC_ROOT}" >&2
    exit 1
  fi
else
  echo "Available datasets in ${SRC_ROOT}:"
  for i in "${!DATASETS[@]}"; do
    printf "  %d) %s\n" "$((i + 1))" "${DATASETS[$i]}"
  done
  read -r -p "Select dataset [1-${#DATASETS[@]}]: " choice
  if [[ ! "${choice}" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > ${#DATASETS[@]} )); then
    echo "Error: Invalid selection '${choice}'" >&2
    exit 1
  fi
  SELECTED="${DATASETS[$((choice - 1))]}"
fi

SRC_DATASET_DIR="${SRC_ROOT}/${SELECTED}"
mkdir -p "${DEST_DIR}"

shopt -s nullglob
FILES=(
  "${SRC_DATASET_DIR}"/hso-investigation/*
  "${SRC_DATASET_DIR}"/student-tracking-project/*
)

if [[ ${#FILES[@]} -eq 0 ]]; then
  FILES=("${SRC_DATASET_DIR}"/*)
fi

for src_file in "${FILES[@]}"; do
  [[ -f "${src_file}" ]] || continue
  base_name="$(basename "${src_file}")"
  [[ "${base_name}" == "urls.md" || "${base_name}" == "test_llm_prompt.md" ]] && continue
  dest_name="${base_name/_core./.}"
  if [[ "${dest_name}" == "incident_briefing.md" ]]; then
    cp -f "${src_file}" "${REPO_ROOT}/${dest_name}"
    echo "Copied ${SELECTED}/${base_name} -> ${dest_name}"
  else
    cp -f "${src_file}" "${DEST_DIR}/${dest_name}"
    echo "Copied ${SELECTED}/${base_name} -> datasets/${dest_name}"
  fi
done
