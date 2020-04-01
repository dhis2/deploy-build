# deploy-build

GitHub Action to deploy an artifact to another organization on GitHub.

DHIS2 uses this to store our build artifacts for repos under
github.com/dhis2 at github.com/d2-ci.

E.g. dhis2/maintenance-app gets build and the artifact of that gets put
in d2-ci/maintenance-app.

More information about the build system and the role d2-ci plays is
available at the [developer
portal](https://developers.dhis2.org/2019/02/the-build-system/#d2-ci-organisation).

# Usage

Create a workflow, or use the example in
[dhis2/workflows](https://github.com/dhis2/workflows/blob/master/ci/dhis2-artifacts.yml)
as a base.

To use in an existing workflow, add the action to a step after the build
process:

```
- uses: dhis2/deploy-build@master
  with:
      github-token: ${{ env.GH_TOKEN }}
```

We use `GH_TOKEN` and not `GITHUB_TOKEN` to distinguish between the user
who pushed (`GITHUB_TOKEN`) and the PAT of our bot account (`GH_TOKEN`).

# Options

See the [`action.yml`](action.yml) file for an overview of the
configuration possibilities. In DHIS2 scenarios, the defaults should be
sane.
