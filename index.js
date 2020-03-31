const path = require('path')
const fs = require('fs')

const core = require('@actions/core')
const github = require('@actions/github')

const git = require('isomorphic-git')
const http = require('isomorphic-git/http/node')
const shell = require('shelljs')
const fg = require('fast-glob')

// workaround to allow NCC to bundle these dynamically loaded modules
require('shelljs/src/rm')
require('shelljs/src/find')
require('shelljs/src/echo')
require('shelljs/src/cp')
require('shelljs/src/ls')
require('shelljs/src/test')
require('shelljs/src/mkdir')
require('shelljs/src/to')
require('shelljs/src/head')

try {
    const payload = JSON.stringify(github.context.payload, undefined, 2)
    core.debug(`The event payload: ${payload}`)

    main()
} catch (error) {
    core.setFailed(error.message)
}

async function main() {
    const build_dir = core.getInput('build-dir')
    const cwd = core.getInput('cwd')
    const gh_token = core.getInput('github-token')
    const gh_org = core.getInput('github-org')
    const gh_usr = core.getInput('github-user')

    const pkg = require(path.join(cwd, '/package.json'))

    const opts = {
        build_dir,
        cwd,
        gh_token,
        gh_org,
        gh_usr,
    }

    core.startGroup('options')
    core.info('Options for run:')
    core.info(`${JSON.stringify(opts, undefined, 2)}`)
    core.endGroup()

    try {
        if (pkg.workspaces) {
            const ws = await fg(pkg.workspaces, {
                onlyDirectories: true,
                dot: false,
            })

            core.info(ws)

            Promise.all(
                ws.map(async w => {
                    const wsPkg = await fg(['package.json'], {
                        cwd: w,
                    })

                    core.info(wsPkg)

                    await deployRepo({
                        ...opts,
                        repo: w,
                        base: path.basename(w),
                        pkg: wsPkg,
                    })
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
    const { base, repo, gh_org, gh_usr, gh_token, build_dir } = opts

    const context = github.context
    const octokit = new github.GitHub(gh_token)

    const config = {
        fs,
        dir: repo,
    }

    const [result] = await git.log({
        ...config,
        depth: 1,
    })
    core.info(result)

    const sha = result.oid
    core.info(sha)

    const short_sha = sha.substring(0, 7)
    core.info(short_sha)

    const commit_msg = result.commit.message
    core.info(commit_msg)

    const committer_name = result.commit.committer.name
    core.info(committer_name)

    const committer_email = result.commit.committer.email
    core.info(committer_email)

    const ghRoot = gh_usr ? gh_usr : gh_org

    const ref = context.ref || (await git.currentBranch(config))
    const short_ref = await format_ref(ref, config)
    core.info(short_ref)

    process.exit(0)

    try {
        if (gh_usr) {
            const create_user_repo = await octokit.repos.createForAuthenticatedUser(
                {
                    name: base,
                    auto_init: true,
                }
            )
            core.info(create_user_repo)
        } else {
            const create_org_repo = await octokit.repos.createInOrg({
                name: base,
                org: gh_org,
                auto_init: true,
            })
            core.info(create_org_repo)
        }
    } catch (e) {
        core.warning('Failed to create the repo, probably exists, which is OK!')
        core.debug(e)
    }

    const build_repo_url = `https://github.com/${ghRoot}/${base}.git`
    core.info(build_repo_url)

    const build_repo_path = path.join('tmp', base)
    core.info(build_repo_path)

    const res_rm = shell.rm('-rf', build_repo_path)
    core.info('rm', res_rm.code)

    const res_mkd = shell.mkdir('-p', build_repo_path)
    core.info('mkdir', res_mkd.code)

    await git.init({
        ...config,
        dir: build_repo_path,
    })

    await git.addRemote({
        ...config,
        dir: build_repo_path,
        remote: 'artifact',
        url: build_repo_url,
    })

    const remote_info = await git.getRemoteInfo({
        http,
        url: build_repo_url,
    })
    core.info(remote_info)

    try {
        const res_fetch = await git.fetch({
            ...config,
            http,
            url: build_repo_url,
            dir: build_repo_path,
            depth: 1,
            ref: short_ref,
            remote: 'artifact',
        })

        core.info(res_fetch)

        await git.checkout({
            ...config,
            dir: build_repo_path,
            remote: 'artifact',
            ref: short_ref,
        })

        core.info('switched to branch', short_ref)
    } catch (e) {
        core.error('could not fetch ref', short_ref, e)
    }

    try {
        await git.branch({
            ...config,
            dir: build_repo_path,
            ref: short_ref,
            checkout: true,
        })

        core.info('created branch', short_ref)
    } catch (e) {
        core.error('failed to create branch', short_ref, e)
    }

    if (shell.test('-d', build_dir)) {
        core.info('copy build artifacts')
        const res_cp_build = shell.cp(
            '-r',
            path.join(build_dir, '*'),
            build_repo_path
        )
        core.info('cp', res_cp_build.code)

        const res_cp_pkg = shell.cp(
            path.join(repo, 'package.json'),
            path.join(build_repo_path, 'package.json')
        )
        core.info('cp_pkg', res_cp_pkg.code)
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

        core.info(res_find)
        res_find.map(f => shell.cp('-rf', f, build_repo_path))
    }

    shell
        .echo(`${new Date()}\n${sha}`)
        .to(path.join(build_repo_path, 'BUILD_INFO'))

    await git.add({
        ...config,
        dir: build_repo_path,
        filepath: '.',
    })

    const short_msg = shell.echo(`${commit_msg}`).head({ '-n': 1 })

    const commit_sha = await git.commit({
        ...config,
        dir: build_repo_path,
        message: `${short_sha} ${short_msg}`,
        author: {
            name: committer_name,
            email: committer_email,
        },
    })

    core.info(commit_sha)

    const res_push = await git.push({
        ...config,
        http,
        dir: build_repo_path,
        ref: short_ref,
        remote: 'artifact',
        force: true,
        onAuth: () => ({ username: gh_token }),
    })

    core.info('push', res_push)
}

async function format_ref(ref, opts) {
    let full_ref = ref
    try {
        full_ref = await git.expandRef({
            ...opts,
            ref,
        })
    } catch (e) {
        core.error('could not expand ref')
    }

    return full_ref
        .split('/')
        .slice(2)
        .join('/')
}
