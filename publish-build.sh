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

function deployPackage () {
    local COMPONENT=$1
    local REPO_DIR=$2

    COMPONENT=${COMPONENT//_/-}

    BUILD_REPO_NAME="${COMPONENT}"
    BUILD_REPO_DIR="tmp/${BUILD_REPO_NAME}"

    version=$(node -pe "require('./package.json').version")
    echo "Publishing version: ${version}"


    if [[ -d "$BUILD_REPO_DIR" ]]; then
        npm publish "$BUILD_REPO_DIR" --tag "$DIST_TAG" --access public
    else
        npm publish --tag "$DIST_TAG" --access public
    fi
}

DIST_TAG=latest

ROOT=$(basename $(pwd))

echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc
echo "//registry.npmjs.org/:username=travis4dhis2" >> ~/.npmrc
echo "//registry.npmjs.org/:email=deployment@dhis2.org" >> ~/.npmrc

if [[ ! -d "packages" ]]; then
    dir=$(pwd)
    deployPackage "$ROOT" "$dir"
else
    for dir in packages/*/
    do
        COMPONENT=$(basename ${dir})
        PREFIX=${ROOT//-app/}
        deployPackage "${PREFIX}-${COMPONENT}" "$dir"
    done
fi

exit 0
