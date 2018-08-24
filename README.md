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
