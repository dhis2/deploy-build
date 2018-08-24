# deploy-build

Deploys a build artifact from `$REPO_NAME` to `${REPO_NAME}-builds`.
These builds can be pulled from NPM and can be built into the backend.

## Requirements

- Travis CLI
- Github [Personal Access Token](https://github.com/settings/tokens) for
  build user, unique for the app

## Setup

In the app/lib where you have your `package.json`:

```
yarn add --dev @dhis2/deploy-build
# or
npm install --save-dev @dhis2/deploy-build
```

Add `deploy` script to `package.json`:

```
{
    ...
    "scripts": {
        "deploy": "deploy-build"
    }
    ...
}
```

Create `.travis.yml`:

```
travis init
```

Add the encrypted PAT for the app:

```
travis encrypt --add GITHUB_TOKEN=<github access token here>
```

Example `.travis.yml`:

```
language: node_js
node_js:
- 8.11.1
script:
- npm run build
- npm run deploy
env:
  global:
    secure: <encrypted PAT>
```

# Deploy manually to your own Github account

To deploy a build to your personal github account:

```
export GITHUB_TOKEN=<github token>
yarn deploy -- <github username>
```

# Caveats

## Turn off PR builds in Travis, only use branch builds

If you see commits like: `c9e0584 Merge 46e1c4787... into 8741c7c88...` in your builds repo and don't want them, then turn off the PR builds and just use branch builds.

Travis build the merge commit between the branch and the base, and set the `TRAVIS_BRANCH` env variable to [the base branch](https://docs.travis-ci.com/user/environment-variables#default-environment-variables), which often means master.

By leaving the PR builds off and the branch buils on you still get the benefits of your branch being built and deployed, but avoid the merge commit builds in your master stream.
