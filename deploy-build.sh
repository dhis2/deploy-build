#!/usr/bin/env bash

# Many thanks to the Angular devs for writing this script which has
# served as inspiration:
# https://github.com/angular/angular/blob/master/scripts/ci/publish-build-artifacts.sh

# external environment variables:
# - GITHUB_TOKEN

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

# externally set on env?
readonly CREATE_REPOS=1
##

# setup mode and organisation to publish to
if [ $# -gt 0 ]; then
    ORG=$1
    ENDPOINT="user/repos"
    PROTOCOL="ssh"
else
    ORG="dhis2"
    ENDPOINT="orgs/${ORG}/repos"
    PROTOCOL="https"
fi

#### functions

function getLatestTag {
    # Find the most recent tag that is reachable from the current
    # commit.  This is shallow clone of the repo, so we might need to
    # fetch more commits to find the tag.

    local depth=`git log --oneline | wc -l`
    local latestTag=`git describe --tags --abbrev=0 || echo NOT_FOUND`

    while [ "$latestTag" == "NOT_FOUND" ]; do
        # Avoid infinite loop.
        if [ "$depth" -gt "1000" ]; then
            echo "Error: Unable to find the latest tag." 1>&2
            exit 1;
        fi

        # Increase the clone depth and look for a tag.
        depth=$((depth + 50))
        git fetch --depth=$depth
        latestTag=`git describe --tags --abbrev=0 || echo NOT_FOUND`
    done

    echo $latestTag;
}
####

readonly scriptDir=$(cd "$(dirname "$0")"; pwd)
readonly repoDir=$(pwd)
readonly BUILD_DIR="build"

readonly REPO_NAME=$(basename "$repoDir")
readonly BUILD_REPO_NAME="${REPO_NAME}-builds"
readonly BUILD_REPO_DIR="tmp/${BUILD_REPO_NAME}"

readonly BRANCH=${TRAVIS_BRANCH:-$(git symbolic-ref --short HEAD)}

if [ -n "${CREATE_REPOS:-}" ]; then
    curl -u "$ORG:$GITHUB_TOKEN" "https://api.github.com/${ENDPOINT}" \
         -d '{"name":"'$BUILD_REPO_NAME'", "auto_init": true}'
fi

if [[ "$PROTOCOL" == "ssh" ]]; then
    REPO_URL="git@github.com:${ORG}/${BUILD_REPO_NAME}.git"
elif [[ "$PROTOCOL" == "https" ]]; then
    REPO_URL="https://github.com/${ORG}/${BUILD_REPO_NAME}.git"
else
    die "Don't have a way to publish to scheme $PROTOCOL"
fi

echo "Using '${ORG}/${BUILD_REPO_NAME}' to publish on '${REPO_URL}'..."

SHA=`git rev-parse HEAD`
SHORT_SHA=`git rev-parse --short HEAD`
COMMIT_MSG=`git log --oneline -1`
COMMITTER_USER_NAME=`git --no-pager show -s --format='%cN' HEAD`
COMMITTER_USER_EMAIL=`git --no-pager show -s --format='%cE' HEAD`
LATEST_TAG=`getLatestTag`
BUILD_VER="${LATEST_TAG}+${SHORT_SHA}"

rm -rf "$BUILD_REPO_DIR"
mkdir -p "$BUILD_REPO_DIR"

    (
        cd "$BUILD_REPO_DIR" && \
            git init && \
            git remote add origin "$REPO_URL" && \
            # use the remote branch if it exists
            if git ls-remote --exit-code origin "${BRANCH}"; then
                git fetch origin "${BRANCH}" --depth=1 && \
                git checkout "origin/${BRANCH}"
            fi
            git checkout -b "${BRANCH}"
    )

echo "Copy the build artifacts from ${BUILD_DIR}"
rm -rf $BUILD_REPO_DIR/*
cp -r $BUILD_DIR/* $BUILD_REPO_DIR/

if [[ ${CI:-} ]]; then
    (
        # The file ~/.git_credentials is created in /.circleci/config.yml
        echo "https://${GITHUB_TOKEN}:@github.com" > $HOME/.git_credentials
        cd $BUILD_REPO_DIR && \
            git config credential.helper "store --file=$HOME/.git_credentials"
    )
fi

echo "$(date)" > $BUILD_REPO_DIR/BUILD_INFO
echo "$SHA" >> $BUILD_REPO_DIR/BUILD_INFO

(
    cd $BUILD_REPO_DIR && \
    git config user.name "${COMMITTER_USER_NAME}" && \
    git config user.email "${COMMITTER_USER_EMAIL}" && \
    git add --all && \
    git commit -m "${COMMIT_MSG}" --quiet && \
    git tag "${BUILD_VER}" && \
    git push origin "${BRANCH}" --tags --force
)

exit 0
