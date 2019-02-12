#!/usr/bin/env bash

###
# external environment variables:
# - TRAVIS_TAG
###

# start: shellharden
if test "$BASH" = "" || "$BASH" -uc "a=();true \"\${a[@]}\"" 2>/dev/null; then
    # Bash 4.4, Zsh
    set -euo pipefail
else
    # Bash 4.3 and older chokes on empty arrays with set -u.
    set -eo pipefail
fi
set -x # print all commands
shopt -s nullglob globstar
# end: shellharden

function printerr () {
    >&2 echo -e "\e[91m${1}\e[0m"
}

if [[ ! ${TRAVIS_TAG:-} ]]; then
    printerr "Not built from a Git tag, do not publish!"
    exit 0
fi

DRYRUN=0
if [ $# -gt 0 ] && [ "$1" == "--dry-run" ]; then
    DRYRUN=1
    printerr "PERFORMING DRY RUN"
fi

# this part needs to be expanded for other dist-tags
# based on api levels

function exec () {
    local CMD=$1

    if [ $DRYRUN -eq 1 ]; then
        echo $CMD
    else
        `${CMD}`
    fi
}

function publishPackage () {
    local PACKAGE_DIR=$1
    local PACKAGE_JSON="${PACKAGE_DIR}/package.json"

    if [[ ! -e ${PACKAGE_JSON} ]]; then
        printerr "Package.json file '${PACKAGE_JSON}' does not exist, skipping publish."
    else
        name=$(node -pe "require('${PACKAGE_JSON}').name")
        version=$(node -pe "require('${PACKAGE_JSON}').version")
        echo "Publishing package: ${name} @ ${version}"

        exec "npm publish \"$PACKAGE_DIR\" --tag \"$DIST_TAG\" --access public"
    fi
}

DIST_TAG=latest
BUILDS_DIR="./tmp/builds"

echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc
echo "//registry.npmjs.org/:username=travis4dhis2" >> ~/.npmrc
echo "//registry.npmjs.org/:email=deployment@dhis2.org" >> ~/.npmrc

if [[ ! -d "./packages" ]] && [[ ! -d "${BUILDS_DIR}" ]]; then
    dir=$(pwd)
    publishPackage "${dir}"
elif [[ -d "${BUILDS_DIR}" ]]; then
    for dir in ${BUILDS_DIR}/*/
    do
        publishPackage "${dir%/}"
    done
else
    for dir in ./packages/*/
    do
        publishPackage "${dir%/}"
    done
fi

exit 0
