###
#### functions
###

BUILDS_DIR="tmp/builds"

function getLatestTag {
    ###
    # Find the most recent tag that is reachable from the current
    # commit.  This is shallow clone of the repo, so we might need to
    # fetch more commits to find the tag.
    ###

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

function getVersion {
    local dir=$1
    local JSON="${dir}/package.json"
    $JQ --exit-status '(.version)' $JSON
}

function getPackageName {
    local dir=$1
    local JSON="${dir}/package.json"
    $JQ --exit-status '(.name)' $JSON
}

function deployRepo {
    local COMPONENT=$1
    local REPO_DIR=$2

    COMPONENT=${COMPONENT//_/-}

    SHA=`git rev-parse HEAD`
    SHORT_SHA=`git rev-parse --short HEAD`
    COMMIT_MSG=`git log --oneline -1`
    COMMITTER_USER_NAME=`git --no-pager show -s --format='%cN' HEAD`
    COMMITTER_USER_EMAIL=`git --no-pager show -s --format='%cE' HEAD`
    LATEST_TAG=`getLatestTag`
    BUILD_VER="${LATEST_TAG}+${SHORT_SHA}"

    BUILD_REPO_NAME="${COMPONENT}"
    BUILD_DIR="${REPO_DIR}/${SUBDIR}"
    BUILD_REPO_DIR="${BUILDS_DIR}/${BUILD_REPO_NAME}"

    BRANCH=${TRAVIS_BRANCH:-$(git symbolic-ref --short HEAD)}
    
    if [ -n "${CREATE_REPOS:-}" ]; then
        curl -u "$ORG:$GITHUB_TOKEN" "https://api.github.com/${ENDPOINT}" \
             -d '{"name":"'$BUILD_REPO_NAME'", "auto_init": true}'
    fi

    if [[ "$PROTOCOL" == "ssh" ]]; then
        REPO_URL="git@github.com:${ORG}/${BUILD_REPO_NAME}.git"
    elif [[ "$PROTOCOL" == "https" ]]; then
        REPO_URL="https://github.com/${ORG}/${BUILD_REPO_NAME}.git"
    else
        echo "Don't have a way to publish to scheme $PROTOCOL"
        exit 1
    fi

    echo "Using '${ORG}/${BUILD_REPO_NAME}' to publish on '${REPO_URL}'..."

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

    if [[ -d "$BUILD_DIR" ]]; then
        echo "Copy the build artifacts from ${BUILD_DIR}"
        rm -rf $BUILD_REPO_DIR/*
        cp -r $BUILD_DIR/* $BUILD_REPO_DIR/

        echo "Copy package.json to ${BUILD_REPO_DIR}"
        cp "${REPO_DIR}/package.json" "${BUILD_REPO_DIR}/package.json"
    else
        echo "No build directory, assume root package deployment."
        find "$REPO_DIR" -maxdepth 1 \
            -not -path "$REPO_DIR" \
            -not -path "*tmp*" \
            -not -path "*\.git" \
            -exec cp -r -t $BUILD_REPO_DIR {} +
    fi

    if [[ ${CI:-} ]]; then
        (
            echo "https://${GITHUB_TOKEN}:@github.com" > $HOME/.git_credentials
            cd $BUILD_REPO_DIR && \
                git config credential.helper "store --file=$HOME/.git_credentials"
        )
    fi

    echo "$(date)" > $BUILD_REPO_DIR/BUILD_INFO
    echo "$SHA" >> $BUILD_REPO_DIR/BUILD_INFO

    if [[ "$COMPONENT" == *-app ]]; then
        echo "Trim the package.json file"
        $JQ --exit-status "{
            name: .name,
            description: .description,
            license: .license,
            version: \"$pkg_ver\"
        }" $BUILD_REPO_DIR/package.json > $BUILD_REPO_DIR/package-min.json
    else
        echo "${COMPONENT} did not end with -app, skip trim of package.json"
        $JQ --exit-status "(
            if has(\"main\") then .main |= sub(\"build\/\"; \"\") else . end|
            if has(\"module\") then .module |= sub(\"build\/\"; \"\") else . end|
            if has(\"browser\") then .browser |= sub(\"build\/\"; \"\") else . end|

            if has(\"dependencies\") then .dependencies |=
                (.|with_entries(if .value == \"0.0.0-PLACEHOLDER\" then .value |= \"$pkg_ver\" else . end)) else . end|
            if has(\"peerDependencies\") then .peerDependencies |=
                (.|with_entries(if .value == \"0.0.0-PLACEHOLDER\" then .value |= \"$pkg_ver\" else . end)) else . end|

            .private = false|
            .version = \"$pkg_ver\"
        )" $BUILD_REPO_DIR/package.json > $BUILD_REPO_DIR/package-min.json
    fi

    cat $BUILD_REPO_DIR/package-min.json
    mv $BUILD_REPO_DIR/package-min.json $BUILD_REPO_DIR/package.json

    (
        cd $BUILD_REPO_DIR && \
        git config user.name "${COMMITTER_USER_NAME}" && \
        git config user.email "${COMMITTER_USER_EMAIL}" && \
        git add --all && \
        git commit -m "${COMMIT_MSG}" --quiet && \
        git tag "${BUILD_VER}" && \
        git push origin "${BRANCH}" --tags --force
    )
}

function deployPackage {
    local baseDir=$(pwd)
    local pkg_ver=$(getVersion "$baseDir")
    local pkg_name=$(getPackageName "$baseDir")

    # strip wrapping quotes
    pkg_ver=${pkg_ver//\"/}
    pkg_name=${pkg_name//\"/}

    if [[ ! -d "packages" ]]; then
        deployRepo "$ROOT" "$baseDir"
    else
        for dir in packages/*/
        do
            local COMPONENT=$(getPackageName ${dir})
            COMPONENT=${COMPONENT//@dhis2\//}
            COMPONENT=${COMPONENT//\"/}

            # justin case
            if [[ "$pkg_ver" == "null" ]]; then
                pkg_ver=$(getVersion "$dir")
                pkg_ver=${pkg_ver//\"/}
            fi

            deployRepo "${COMPONENT}" "$dir"
        done
    fi
}

function getJQ {
    echo "Install jq dep"
    curl -L -o "./jq" "https://github.com/stedolan/jq/releases/download/jq-1.5/jq-linux64"
    chmod +x "./jq"
    JQ="./jq"
}

###
#### start script
###

readonly scriptDir=$(cd "$(dirname "$0")"; pwd)
readonly CREATE_REPOS=1
readonly ROOT=$(basename $(pwd))

echo "Script running in: ${scriptDir}"

if [ $# -gt 1 ]; then
    readonly SUBDIR=$2
else
    readonly SUBDIR="build"
fi

if [ $# -gt 0 ] && [ "$1" -ne "d2-ci"]; then
    readonly ORG=$1
    readonly ENDPOINT="user/repos"
    readonly PROTOCOL="ssh"
else
    readonly ORG="d2-ci"
    readonly ENDPOINT="orgs/${ORG}/repos"
    readonly PROTOCOL="https"
fi

if [[ ! -x "$(command -v jq)" ]]; then
    getJQ
else
    echo "jq binary found"
    JQ="jq"
fi
deployPackage

exit 0
