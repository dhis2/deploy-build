# build tools

## deploy-build.sh

Deploys a build artifact from `dhis2/$REPO_NAME` to `d2-ci/${REPO_NAME}`.
These builds can be pulled from NPM and can be built into the backend.

## publish-build.sh

Publishes a build artifact to NPM if the `$TRAVIS_TAG` environment variable exists.

Cutting the release is done locally, then the tag is pushed.

Travis runs through the build process and then deploys the artifact to the builds repo, and then publishes the version to NPM. 

## Requirements

- Travis CLI
- Github [Personal Access Token](https://github.com/settings/tokens) for
  build user, unique for the app
- NPM Token for user [travis4dhis2](https://www.npmjs.com/settings/travis4dhis2/tokens)

## Setup

Create `.travis.yml`:

```
travis init
```

Add the encrypted PAT for the app:

```
travis encrypt GITHUB_TOKEN=<github access token here> --add
travis encrypt NPM_TOKEN=<npm access token here> --add
```

Example `.travis.yml`:

```
language: node_js
node_js:
- 8
before_script:
- npm install --global @dhis2/deploy-build
script:
- npm run lint
- npm run coverage
- npm run build
deploy:
- provider: script
  script: deploy-build
  skip_cleanup: true
  on:
    all_branches: true
- provider: script
  script: publish-build
  skip_cleanup: true
  on:
    tags: true
env:
  global:
    secure: <encrypted PAT>
    secure: <encrypted PAT>
```

# Deploy manually to your own Github account

To deploy a build to your personal github account:

```
npm install --global @dhis2/deploy-build
export GITHUB_TOKEN=<github token>
deploy-build <github username>
```

# Caveats

## Turn off PR builds in Travis, only use branch builds

If you see commits like: `c9e0584 Merge 46e1c4787... into 8741c7c88...` in your builds repo and don't want them, then turn off the PR builds and just use branch builds.

Travis build the merge commit between the branch and the base, and set the `TRAVIS_BRANCH` env variable to [the base branch](https://docs.travis-ci.com/user/environment-variables#default-environment-variables), which often means master.

By leaving the PR builds off and the branch buils on you still get the benefits of your branch being built and deployed, but avoid the merge commit builds in your master stream.

# Install dependency from GitHub, e.g. for DHIS2 core

```
# for master branch
npm install ${app}@dhis2/${app}

# for 2.30
npm install ${app}@dhis2/${app}#2.30

# for random feature branch
npm install ${app}@dhis2/${app}#feature/random-branch-name
```
