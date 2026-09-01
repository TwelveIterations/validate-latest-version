import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest
} from '@jest/globals'
import type { ValidationResult } from '../src/validate'

describe('run', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  async function loadRun(
    validationResult: ValidationResult,
    inputOverrides: Record<string, string> = {}
  ) {
    const core = await import('../__fixtures__/core')
    core.getInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        rootPath: '/repo',
        versionCatalog: 'gradle/libs.versions.toml',
        nexusUrl: 'https://nexus.example/search',
        repository: 'maven-public',
        groupId: 'net.blay09.mods',
        versionKey: 'balm',
        artifactId: 'balm-common',
        ...inputOverrides
      }

      return inputs[name] ?? ''
    })

    const validateLatestVersion = jest.fn(async () => validationResult)

    jest.unstable_mockModule('@actions/core', () => core)
    jest.unstable_mockModule('../src/validate.js', () => ({
      validateLatestVersion
    }))

    const { run } = await import('../src/main')
    return { core, run, validateLatestVersion }
  }

  it('sets successful outputs when the version is current', async () => {
    const result: ValidationResult = {
      success: true,
      failures: [],
      result: {
        versionKey: 'balm',
        artifactId: 'balm-common',
        configuredVersion: '26.2.0.6',
        latestVersion: '26.2.0.6',
        branch: '26.2',
        upToDate: true
      }
    }
    const { core, run, validateLatestVersion } = await loadRun(result)

    await run()

    expect(validateLatestVersion).toHaveBeenCalledWith({
      rootPath: '/repo',
      versionCatalog: 'gradle/libs.versions.toml',
      nexusUrl: 'https://nexus.example/search',
      repository: 'maven-public',
      groupId: 'net.blay09.mods',
      rejectIfNotDeclared: true,
      rejectOnFutureVersion: true,
      rejectOnSnapshotVersion: true,
      dependency: { versionKey: 'balm', artifactId: 'balm-common' }
    })
    expect(core.setOutput).toHaveBeenCalledWith('success', true)
    expect(core.setOutput).toHaveBeenCalledWith(
      'result',
      JSON.stringify(result.result)
    )
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('fails the action when any version is outdated', async () => {
    const { core, run } = await loadRun({
      success: false,
      failures: ['balm is out of date: 26.2.0.6 < 26.2.0.7']
    })

    await run()

    expect(core.error).toHaveBeenCalledWith(
      'balm is out of date: 26.2.0.6 < 26.2.0.7'
    )
    expect(core.setFailed).toHaveBeenCalledWith(
      'Dependency version validation failed'
    )
  })

  it('does not log up-to-date success when validation failed', async () => {
    const { core, run } = await loadRun({
      success: false,
      failures: ['balm references an unreleased version: 26.2.0.8 > 26.2.0.7'],
      result: {
        versionKey: 'balm',
        artifactId: 'balm-common',
        configuredVersion: '26.2.0.8',
        latestVersion: '26.2.0.7',
        branch: '26.2',
        upToDate: true
      }
    })

    await run()

    expect(core.info).not.toHaveBeenCalledWith('balm is up to date: 26.2.0.8')
    expect(core.setFailed).toHaveBeenCalledWith(
      'Dependency version validation failed'
    )
  })

  it('passes false validation options through to the validator', async () => {
    const result: ValidationResult = {
      success: true,
      failures: []
    }
    const { run, validateLatestVersion } = await loadRun(result, {
      rejectIfNotDeclared: 'false',
      rejectOnFutureVersion: 'false',
      rejectOnSnapshotVersion: 'false'
    })

    await run()

    expect(validateLatestVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        rejectIfNotDeclared: false,
        rejectOnFutureVersion: false,
        rejectOnSnapshotVersion: false
      })
    )
  })
})
