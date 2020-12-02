const path = require('path')
const fs = require('fs')

const core = require('@actions/core')
const github = require('@actions/github')

const git = require('isomorphic-git')
const http = require('isomorphic-git/http/node')
const shell = require('shelljs')
const fg = require('fast-glob')

// workaround to allow NCC to bundle these dynamically loaded modules
require('shelljs/src/cat')
require('shelljs/src/rm')
require('shelljs/src/find')
require('shelljs/src/echo')
require('shelljs/src/cp')
require('shelljs/src/ls')
require('shelljs/src/test')
require('shelljs/src/mkdir')
require('shelljs/src/to')
require('shelljs/src/head')

shell.config.verbose = true

// Equivalent to "git add -A ."
async function gitAddAllRecursive({ fs, dir }) {
    const statusMatrix = await git.statusMatrix({
        fs,
        dir: dir,
        filepaths: ['.'],
    })
    return await Promise.all(
        statusMatrix.map(([filepath, , worktreeStatus]) =>
            worktreeStatus
                ? git.add({ fs, dir, filepath: filepath })
                : git.remove({ fs, dir, filepath: filepath })
        )
    )
}

const gitStatusToString = (headStatus, stageStatus) => {
    switch (stageStatus - headStatus) {
        case -1:
            return 'DELETED'
        case 0:
            return 'UNMODIFIED'
        case 1:
            return 'MODIFIED'
        case 2:
            return 'ADDED'
        default:
            return 'UNKNOWN'
    }
}
async function gitListStagedStatuses({ fs, dir, filepath }) {
    const statuses = (
        await git.statusMatrix({
            fs,
            dir,
            filepaths: [filepath],
        })
    ).map(
        ([filepath, headStatus, , stageStatus]) =>
            `${filepath}: ${gitStatusToString(headStatus, stageStatus)}`
    )
    core.startGroup('git file statuses')
    statuses.forEach(core.info)
    core.endGroup()
}

try {
    const payload = JSON.stringify(github.context.payload, undefined, 2)
    core.debug(`The event payload: ${payload}`)

    main()
} catch (error) {
    core.setFailed(error.message)
}

async function main() {
    core.startGroup('Runtime parameters:')
    core.info(`CWD: ${process.cwd()}`)
    core.info(`CWD ls: ${shell.ls(process.cwd())}`)
    core.endGroup()

    const build_dir = core.getInput('build-dir')
    const cwd = path.resolve(process.cwd(), core.getInput('cwd'))
    const gh_token = core.getInput('github-token')
    const gh_org = core.getInput('github-org')
    const gh_usr = core.getInput('github-user')
    const build_repo = core.getInput('repo-name')

    const opts = {
        build_dir,
        cwd,
        gh_token,
        gh_org,
        gh_usr,
        build_repo,
    }

    core.startGroup('Options for run:')
    core.info(`${JSON.stringify(opts, undefined, 2)}`)
    core.endGroup()

    const pkg_path = path.join(cwd, 'package.json')
    const pkg = JSON.parse(shell.cat(pkg_path))

    core.startGroup('Loaded package')
    core.info(`pkg ls: ${shell.ls(cwd)}`)
    core.info(`pkg path: ${pkg_path}`)
    core.info(JSON.stringify(pkg, undefined, 2))
    core.endGroup()

    try {
        if (pkg.workspaces) {
            core.info(`found workspaces: ${pkg.workspaces}`)

            const ws = fg.sync(pkg.workspaces, {
                onlyDirectories: true,
                dot: false,
                cwd,
            })

            core.info(`workspaces: ${ws}`)

            Promise.all(
                ws.map(async w => {
                    core.info(`workspace: ${w}`)
                    const ws_cwd = path.join(cwd, w)
                    core.info(`ws cwd: ${ws_cwd}`)

                    const [ws_pkg_path] = fg.sync(['package.json'], {
                        cwd: ws_cwd,
                        onlyFiles: true,
                        absolute: true,
                        dot: false,
                    })

                    core.info(`ws pkg path: ${ws_pkg_path}`)

                    const ws_pkg = JSON.parse(shell.cat(ws_pkg_path))

                    core.startGroup('Loaded WS package')
                    core.info(`path: ${ws_pkg_path}`)
                    core.info(JSON.stringify(ws_pkg, undefined, 2))
                    core.endGroup()

                    try {
                        await deployRepo({
                            ...opts,
                            repo: ws_cwd,
                            base: path.basename(ws_cwd),
                            pkg: ws_pkg,
                            monorepo: true,
                        })
                    } catch (e) {
                        core.setFailed(e.message)
                    }
                })
            )
        } else {
            await deployRepo({
                ...opts,
                repo: cwd,
                base: path.basename(cwd),
                pkg,
            })
        }
    } catch (error) {
        core.setFailed(error.message)
    }
}

async function deployRepo(opts) {
    const { base, repo, gh_org, gh_usr, gh_token, build_dir, pkg, build_repo, monorepo } = opts

    const context = github.context
    const octokit = new github.GitHub(gh_token)

    core.startGroup('GH Context')
    core.info(`context: ${JSON.stringify(context, undefined, 2)}`)
    core.endGroup()

    const ref = context.ref
    core.info(`git ref: ${ref}`)

    const config = {
        fs,
        dir: repo,
    }

    const short_ref = await format_ref(ref, config)
    core.info(`short ref: ${short_ref}`)

    const sha = context.sha
    core.info(`sha: ${sha}`)

    const short_sha = sha.substring(0, 7)
    core.info(`short sha: ${short_sha}`)

    const commit_msg = context.payload.head_commit.message
    core.info(`commit message: ${commit_msg}`)

    const committer_name = context.payload.head_commit.committer.name
    core.info(`committer name: ${committer_name}`)

    const committer_email = context.payload.head_commit.committer.email
    core.info(`committer email: ${committer_email}`)

    const ghRoot = gh_usr ? gh_usr : gh_org

    // drop the scope from e.g. @dhis2/foobar to foobar
    const strip = (name) => path.basename(name)

    // monorepos default to package name
    const repo_name = strip(monorepo ? pkg.name : build_repo)

    core.info(`build repo name: ${repo_name}`)

    try {
        if (gh_usr) {
            const create_user_repo = await octokit.repos.createForAuthenticatedUser(
                {
                    name: repo_name,
                    auto_init: true,
                }
            )
            core.info(`create user repo: ${create_user_repo}`)
        } else {
            const create_org_repo = await octokit.repos.createInOrg({
                name: repo_name,
                org: gh_org,
                auto_init: true,
            })
            core.info(`create org repo: ${create_org_repo}`)
        }
    } catch (e) {
        core.warning('Failed to create the repo, probably exists, which is OK!')
        core.debug(e.message)
    }

    const artifact_repo_url = `https://github.com/${ghRoot}/${repo_name}.git`
    core.info(`artifact repo url: ${artifact_repo_url}`)

    const artifact_repo_path = path.resolve(process.cwd(), 'tmp', base)
    core.info(`build repo path: ${artifact_repo_path}`)

    const res_rm = shell.rm('-rf', artifact_repo_path)
    core.info(`rm: ${res_rm.code}`)

    const res_mkd = shell.mkdir('-p', artifact_repo_path)
    core.info(`mkdir: ${res_mkd.code}`)

    await git.init({
        ...config,
        dir: artifact_repo_path,
    })

    await git.addRemote({
        ...config,
        dir: artifact_repo_path,
        remote: 'artifact',
        url: artifact_repo_url,
    })

    const remote_info = await git.getRemoteInfo({
        http,
        url: artifact_repo_url,
    })
    core.startGroup('remote info')
    core.info(JSON.stringify(remote_info, undefined, 2))
    core.endGroup()

    try {
        const res_fetch = await git.fetch({
            ...config,
            http,
            url: artifact_repo_url,
            dir: artifact_repo_path,
            depth: 1,
            ref: short_ref,
            singleBranch: true,
            tags: false,
            remote: 'artifact',
        })

        core.startGroup('remote fetch')
        core.info(JSON.stringify(res_fetch, undefined, 2))
        core.endGroup()

        await git.checkout({
            ...config,
            dir: artifact_repo_path,
            remote: 'artifact',
            ref: short_ref,
        })

        core.info(`switched to branch: ${short_ref}`)
    } catch (e) {
        core.warning(`could not fetch ref: ${short_ref}`)
        core.debug(e.message)
    }

    try {
        await git.branch({
            ...config,
            dir: artifact_repo_path,
            ref: short_ref,
            checkout: true,
        })

        core.info(`created branch: ${short_ref}`)
    } catch (e) {
        core.warning(`failed to create branch: ${short_ref}`)
        core.debug(e.message)
    }

    const repo_build_dir = path.join(repo, build_dir)

    const res_rm_build = shell.rm('-rf', path.join(artifact_repo_path, '*'))
    core.info(`rm build: ${res_rm_build.code}`)

    if (shell.test('-d', repo_build_dir)) {
        core.info('copy build artifacts')

        const res_cp_build = shell.cp(
            '-r',
            path.join(repo_build_dir, '*'),
            artifact_repo_path
        )
        core.info(`cp build: ${res_cp_build.code}`)

        const res_cp_pkg = shell.cp(
            `${repo}/package.json`,
            `${artifact_repo_path}/package.json`
        )
        core.info(`cp pkg: ${res_cp_pkg.code}`)
    } else {
        core.info('root package deployment')
        const res_find = shell
            .ls(repo)
            .filter(
                f =>
                    !f.match(/.*tmp.*/) &&
                    !f.match(/.*\.git.*/) &&
                    !f.match(/.*node_modules*/)
            )

        core.info(`find: ${res_find}`)
        res_find.map(f =>
            shell.cp('-r', path.join(repo, f), artifact_repo_path)
        )
    }

    shell
        .echo(`${new Date()}\n${sha}\n${context.payload.head_commit.url}\n`)
        .to(path.join(artifact_repo_path, 'BUILD_INFO'))

    await gitAddAllRecursive({
        ...config,
        dir: artifact_repo_path,
    })

    await gitListStagedStatuses({
        ...config,
        dir: artifact_repo_path,
        filepath: '.',
    })

    const commit_line_length = commit_msg.indexOf('\n')
    const short_msg = commit_msg.substring(
        0,
        commit_line_length === -1 ? commit_msg.length : commit_line_length
    )

    const new_commit_msg = `${short_sha} ${short_msg}`
    core.info(`committing with message: ${new_commit_msg}`)
    const commit_sha = await git.commit({
        ...config,
        dir: artifact_repo_path,
        message: new_commit_msg,
        author: {
            name: committer_name,
            email: committer_email,
        },
    })

    core.info(`commit sha: ${commit_sha}`)

    const res_push = await git.push({
        ...config,
        http,
        dir: artifact_repo_path,
        ref: short_ref,
        remote: 'artifact',
        force: true,
        onAuth: () => ({ username: gh_token }),
    })

    core.startGroup(`push results: ${res_push.ok ? 'OK' : 'ERROR'}`)
    core.info(JSON.stringify(res_push, undefined, 2))
    core.endGroup()
}

async function format_ref(ref, opts) {
    let full_ref = ref
    try {
        full_ref = await git.expandRef({
            ...opts,
            ref,
        })
    } catch (e) {
        core.warning('could not expand ref')
    }

    return full_ref
        .split('/')
        .slice(2)
        .join('/')
}
