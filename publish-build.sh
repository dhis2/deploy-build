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

DIST_TAG=latest

if [[ ! -d "packages" ]]; then
    local dir=$(pwd)
    pushd "${dir}/build"
    local version=$(node -pe "require('./package.json').version")
    echo "Publishing version: ${version}"
    echo npm publish --tag "$DIST_TAG" --access public
    popd
else
    for dir in packages/*/
    do
        pushd "${dir}/build"
        local version=$(node -pe "require('./package.json').version")
        echo "Publishing version: ${version}"
        echo npm publish --tag "$DIST_TAG" --access public
        popd
    done
fi

exit 0
