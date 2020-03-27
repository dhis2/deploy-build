const path = require('path')
const fs = require('fs')

const core = require('@actions/core')
const github = require('@actions/github')

const git = require('isomorphic-git')
const http = require('isomorphic-git/http/node')
const shell = require('shelljs')

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
    console.log(`The event payload: ${payload}`)

    main()
} catch (error) {
    core.setFailed(error.message)
}

async function main() {
    const pkg = require('./package.json')
    const cwd = process.cwd()

    try {
        if (!pkg.workspaces) {
            await deployRepo({
                repo: cwd,
                base: path.basename(cwd),
                pkg,
            })
        } else {
            // monorepo madness
        }
    } catch (error) {
        core.setFailed(error.message)
    }
}

async function deployRepo(opts) {
    const { base, repo } = opts

    const gh_org = core.getInput('github-org')
    const gh_usr = core.getInput('github-user')
    const gh_token = core.getInput('github-token')
    const build_dir = core.getInput('build-dir')

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

    const sha = result.oid
    const short_sha = sha.substring(0, 7)
    const commit_msg = result.commit.message
    const committer_name = result.commit.committer.name
    const committer_email = result.commit.committer.email
    const ghRoot = gh_usr ? gh_usr : gh_org

    const ref = context.ref || (await git.currentBranch(config))
    const short_ref = await format_ref(ref, config)

    console.log(result)
    console.log(sha)
    console.log(short_sha)
    console.log(commit_msg)
    console.log(committer_name)
    console.log(committer_email)
    console.log(short_ref)

    try {
        if (gh_usr) {
            const create_user_repo = await octokit.repos.createForAuthenticatedUser(
                {
                    name: base,
                    auto_init: true,
                }
            )
            console.log(create_user_repo)
        } else {
            const create_org_repo = await octokit.repos.createInOrg({
                name: base,
                org: gh_org,
                auto_init: true,
            })
            console.log(create_org_repo)
        }
    } catch (e) {
        console.log(e)
    }

    const build_repo_url = `https://github.com/${ghRoot}/${base}.git`
    console.log(build_repo_url)

    const build_repo_path = path.join('tmp', base)
    console.log(build_repo_path)

    const res_rm = shell.rm('-rf', build_repo_path)
    console.log('rm', res_rm.code)

    const res_mkd = shell.mkdir('-p', build_repo_path)
    console.log('mkdir', res_mkd.code)

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

    console.log(remote_info)

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

        console.log(res_fetch)

        await git.checkout({
            ...config,
            dir: build_repo_path,
            remote: 'artifact',
            ref: short_ref,
        })

        console.log('switched to branch', short_ref)
    } catch (e) {
        console.log('could not fetch ref', short_ref, e)
    }

    try {
        await git.branch({
            ...config,
            dir: build_repo_path,
            ref: short_ref,
            checkout: true,
        })

        console.log('created branch', short_ref)
    } catch (e) {
        console.log('failed to create branch', short_ref, e)
    }

    if (shell.test('-d', build_dir)) {
        console.log('copy build artifacts')
        const res_cp_build = shell.cp(
            '-r',
            path.join(build_dir, '*'),
            build_repo_path
        )
        console.log('cp', res_cp_build.code)

        const res_cp_pkg = shell.cp(
            path.join(repo, 'package.json'),
            path.join(build_repo_path, 'package.json')
        )
        console.log('cp_pkg', res_cp_pkg.code)
    } else {
        console.log('root package deployment')
        const res_find = shell
            .ls(repo)
            .filter(
                f =>
                    !f.match(/.*tmp.*/) &&
                    !f.match(/.*\.git.*/) &&
                    !f.match(/.*node_modules*/)
            )

        console.log(res_find)
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

    console.log(commit_sha)

    const res_push = await git.push({
        ...config,
        http,
        dir: build_repo_path,
        ref: short_ref,
        remote: 'artifact',
        force: true,
        onAuth: () => ({ username: gh_token }),
    })

    console.log('push', res_push)
}

async function format_ref(ref, opts) {
    let full_ref = ref
    try {
        full_ref = await git.expandRef({
            ...opts,
            ref,
        })
    } catch (e) {
        console.log('could not expand ref')
    }

    return full_ref
        .split('/')
        .slice(2)
        .join('/')
}
