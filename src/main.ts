import * as core from '@actions/core'
import {
  validateLatestVersion,
  type ValidateLatestVersionOptions
} from './validate.js'

function getBooleanInput(name: string, defaultValue: boolean): boolean {
  const value = core.getInput(name, { required: false })
  if (!value) {
    return defaultValue
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') {
    return true
  }
  if (normalized === 'false') {
    return false
  }

  throw new Error(`${name} must be true or false`)
}

export async function run(): Promise<void> {
  try {
    const options: ValidateLatestVersionOptions = {
      rootPath: core.getInput('rootPath', { required: false }) || '.',
      versionCatalog:
        core.getInput('versionCatalog', { required: false }) ||
        'gradle/libs.versions.toml',
      nexusUrl:
        core.getInput('nexusUrl', { required: false }) ||
        'https://maven.twelveiterations.com/service/rest/v1/search',
      repository:
        core.getInput('repository', { required: false }) || 'maven-public',
      groupId:
        core.getInput('groupId', { required: false }) || 'net.blay09.mods',
      rejectOnFutureVersion: getBooleanInput('rejectOnFutureVersion', true),
      rejectOnSnapshotVersion: getBooleanInput('rejectOnSnapshotVersion', true),
      dependency: {
        versionKey: core.getInput('versionKey', { required: true }),
        artifactId: core.getInput('artifactId', { required: true })
      }
    }

    core.info(`Reading version catalog: ${options.versionCatalog}`)
    core.info(
      `Checking ${options.dependency.versionKey} (${options.dependency.artifactId})`
    )

    const result = await validateLatestVersion(options)
    core.setOutput('success', result.success)
    core.setOutput('result', JSON.stringify(result.result ?? null))

    if (result.success && result.result?.upToDate) {
      core.info(
        `${result.result.versionKey} is up to date: ${result.result.configuredVersion}`
      )
    }

    if (!result.success) {
      for (const failure of result.failures) {
        core.error(failure)
      }
      core.setFailed('Dependency version validation failed')
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed(String(error))
    }
  }
}
