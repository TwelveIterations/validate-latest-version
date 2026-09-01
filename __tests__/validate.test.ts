import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest
} from '@jest/globals'
import {
  compareVersions,
  isSnapshotVersion,
  validateLatestVersion,
  versionBranch
} from '../src/validate'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FIXTURES_DIR = path.join(__dirname, '..', '__fixtures__')

describe('validateLatestVersion', () => {
  const rootDir = path.join(FIXTURES_DIR, 'temp_latest_versions')
  const catalogPath = path.join(rootDir, 'gradle', 'libs.versions.toml')
  let fetchMock: jest.MockedFunction<typeof fetch>

  beforeEach(() => {
    fs.mkdirSync(path.dirname(catalogPath), { recursive: true })
    fetchMock = jest.fn<typeof fetch>()
    global.fetch = fetchMock
  })

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true })
    jest.restoreAllMocks()
  })

  function writeCatalog(content: string): void {
    fs.writeFileSync(catalogPath, content)
  }

  function mockNexusVersions(versions: string[]): void {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: versions.map((version) => ({
          version,
          repository: 'maven-releases'
        }))
      })
    } as Response)
  }

  it('returns success when the configured version is latest on its branch', async () => {
    writeCatalog(`[versions]
balm = "26.2.0.6"
`)
    mockNexusVersions(['26.2.0.6'])

    const result = await validateLatestVersion({
      rootPath: rootDir,
      versionCatalog: 'gradle/libs.versions.toml',
      nexusUrl: 'https://nexus.example/search',
      repository: 'maven-public',
      groupId: 'net.blay09.mods',
      rejectOnFutureVersion: true,
      rejectOnSnapshotVersion: true,
      dependency: { versionKey: 'balm', artifactId: 'balm-common' }
    })

    expect(result.success).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.result).toMatchObject({
      versionKey: 'balm',
      artifactId: 'balm-common',
      configuredVersion: '26.2.0.6',
      latestVersion: '26.2.0.6',
      branch: '26.2',
      upToDate: true
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://nexus.example/search?repository=maven-public&group=net.blay09.mods&name=balm-common&version=26.2.*&sort=version'
    )
  })

  it('fails when Nexus has a newer version on the configured branch', async () => {
    writeCatalog(`[versions]
balm = "26.2.0.6"
`)
    mockNexusVersions(['26.2.0.7', '26.2.0.6'])

    const result = await validateLatestVersion({
      rootPath: rootDir,
      versionCatalog: 'gradle/libs.versions.toml',
      nexusUrl: 'https://nexus.example/search',
      repository: 'maven-public',
      groupId: 'net.blay09.mods',
      rejectOnFutureVersion: true,
      rejectOnSnapshotVersion: true,
      dependency: { versionKey: 'balm', artifactId: 'balm-common' }
    })

    expect(result).toMatchObject({
      success: false,
      failures: ['balm is out of date: 26.2.0.6 < 26.2.0.7']
    })
  })

  it('follows Nexus continuation tokens', async () => {
    writeCatalog(`[versions]
balm = "26.2.0.6"
`)
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          continuationToken: 'next-page',
          items: [{ version: '26.2.0.6', repository: 'maven-releases' }]
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ version: '26.2.0.7', repository: 'maven-releases' }]
        })
      } as Response)

    const result = await validateLatestVersion({
      rootPath: rootDir,
      versionCatalog: 'gradle/libs.versions.toml',
      nexusUrl: 'https://nexus.example/search',
      repository: 'maven-public',
      groupId: 'net.blay09.mods',
      rejectOnFutureVersion: true,
      rejectOnSnapshotVersion: true,
      dependency: { versionKey: 'balm', artifactId: 'balm-common' }
    })

    expect(result.success).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain('continuationToken=next-page')
  })

  it('reports missing catalog keys', async () => {
    writeCatalog(`[versions]
balm = "26.2.0.6"
`)
    mockNexusVersions(['26.2.0.6'])

    const result = await validateLatestVersion({
      rootPath: rootDir,
      versionCatalog: 'gradle/libs.versions.toml',
      nexusUrl: 'https://nexus.example/search',
      repository: 'maven-public',
      groupId: 'net.blay09.mods',
      rejectOnFutureVersion: true,
      rejectOnSnapshotVersion: true,
      dependency: { versionKey: 'shogi', artifactId: 'shogi-common' }
    })

    expect(result).toEqual({
      success: false,
      failures: ['Missing shogi version in gradle/libs.versions.toml']
    })
  })

  it('skips missing catalog keys when rejectIfNotDeclared is disabled', async () => {
    writeCatalog(`[versions]
balm = "26.2.0.6"
`)
    mockNexusVersions(['26.2.0.6'])

    const result = await validateLatestVersion({
      rootPath: rootDir,
      versionCatalog: 'gradle/libs.versions.toml',
      nexusUrl: 'https://nexus.example/search',
      repository: 'maven-public',
      groupId: 'net.blay09.mods',
      rejectIfNotDeclared: false,
      rejectOnFutureVersion: true,
      rejectOnSnapshotVersion: true,
      dependency: { versionKey: 'shogi', artifactId: 'shogi-common' }
    })

    expect(result).toEqual({ success: true, failures: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails when the configured version is newer than the latest Maven release', async () => {
    writeCatalog(`[versions]
balm = "26.2.0.8"
`)
    mockNexusVersions(['26.2.0.7'])

    const result = await validateLatestVersion({
      rootPath: rootDir,
      versionCatalog: 'gradle/libs.versions.toml',
      nexusUrl: 'https://nexus.example/search',
      repository: 'maven-public',
      groupId: 'net.blay09.mods',
      rejectOnFutureVersion: true,
      rejectOnSnapshotVersion: true,
      dependency: { versionKey: 'balm', artifactId: 'balm-common' }
    })

    expect(result).toMatchObject({
      success: false,
      failures: ['balm references an unreleased version: 26.2.0.8 > 26.2.0.7'],
      result: {
        configuredVersion: '26.2.0.8',
        latestVersion: '26.2.0.7',
        upToDate: true
      }
    })
  })

  it('allows future versions when rejectOnFutureVersion is disabled', async () => {
    writeCatalog(`[versions]
balm = "26.2.0.8"
`)
    mockNexusVersions(['26.2.0.7'])

    const result = await validateLatestVersion({
      rootPath: rootDir,
      versionCatalog: 'gradle/libs.versions.toml',
      nexusUrl: 'https://nexus.example/search',
      repository: 'maven-public',
      groupId: 'net.blay09.mods',
      rejectOnFutureVersion: false,
      rejectOnSnapshotVersion: true,
      dependency: { versionKey: 'balm', artifactId: 'balm-common' }
    })

    expect(result.success).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('fails snapshot versions before querying Nexus', async () => {
    writeCatalog(`[versions]
balm = "26.2.0.8-SNAPSHOT"
`)

    const result = await validateLatestVersion({
      rootPath: rootDir,
      versionCatalog: 'gradle/libs.versions.toml',
      nexusUrl: 'https://nexus.example/search',
      repository: 'maven-public',
      groupId: 'net.blay09.mods',
      rejectOnFutureVersion: true,
      rejectOnSnapshotVersion: true,
      dependency: { versionKey: 'balm', artifactId: 'balm-common' }
    })

    expect(result).toEqual({
      success: false,
      failures: ['balm is a snapshot version: 26.2.0.8-SNAPSHOT']
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows snapshot versions when rejectOnSnapshotVersion is disabled', async () => {
    writeCatalog(`[versions]
balm = "26.2.0.8-SNAPSHOT"
`)
    mockNexusVersions(['26.2.0.7'])

    const result = await validateLatestVersion({
      rootPath: rootDir,
      versionCatalog: 'gradle/libs.versions.toml',
      nexusUrl: 'https://nexus.example/search',
      repository: 'maven-public',
      groupId: 'net.blay09.mods',
      rejectOnFutureVersion: false,
      rejectOnSnapshotVersion: false,
      dependency: { versionKey: 'balm', artifactId: 'balm-common' }
    })

    expect(result.success).toBe(true)
    expect(result.failures).toEqual([])
  })
})

describe('helpers', () => {
  it('extracts the major minor branch from release versions', () => {
    expect(versionBranch('26.2.0.6+fabric')).toBe('26.2')
  })

  it('detects snapshot versions', () => {
    expect(isSnapshotVersion('26.2.0.6-SNAPSHOT')).toBe(true)
    expect(isSnapshotVersion('26.2.0.6')).toBe(false)
  })

  it('compares numeric version segments', () => {
    expect(compareVersions('26.2.0.10', '26.2.0.9')).toBeGreaterThan(0)
    expect(compareVersions('26.2.0.9', '26.2.0.10')).toBeLessThan(0)
    expect(compareVersions('26.2.0.9', '26.2.0.9+fabric')).toBe(0)
  })
})
