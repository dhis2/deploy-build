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

if [[ ! ${TRAVIS_TAG:-} ]]; then
    echo "Not a built for a Git tag, do not publish!"
    exit 0
fi

# this part needs to be expanded for other dist-tags
# based on api levels

function publishPackage () {
    local PACKAGE_DIR=$1

    name=$(node -pe "require('${PACKAGE_DIR}/package.json').name")
    version=$(node -pe "require('${PACKAGE_DIR}/package.json').version")
    echo "Publishing package: ${name} @ ${version}"

    npm publish "$PACKAGE_DIR" --tag "$DIST_TAG" --access public
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
    for dir in builds/*/
    do
        COMPONENT=$(basename ${dir})
        publishPackage "${BUILDS_DIR}/${COMPONENT}"
    done
else
    for dir in packages/*/
    do
        publishPackage "${dir}"
    done
fi

exit 0
