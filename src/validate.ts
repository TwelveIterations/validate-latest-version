import * as fs from 'fs'
import * as path from 'path'

export interface DependencyConfig {
  versionKey: string
  artifactId: string
}

export interface ValidateLatestVersionOptions {
  rootPath: string
  versionCatalog: string
  nexusUrl: string
  repository: string
  groupId: string
  rejectIfNotDeclared?: boolean
  rejectOnFutureVersion: boolean
  rejectOnSnapshotVersion: boolean
  dependency: DependencyConfig
}

export interface DependencyVersionResult extends DependencyConfig {
  configuredVersion: string
  latestVersion: string
  branch: string
  upToDate: boolean
}

export interface ValidationResult {
  success: boolean
  result?: DependencyVersionResult
  failures: string[]
}

interface NexusSearchResult {
  continuationToken?: string | null
  items?: NexusSearchItem[]
}

interface NexusSearchItem {
  version?: string
  repository?: string
}

export function readVersionCatalog(
  rootPath: string,
  versionCatalog: string
): Map<string, string> {
  const catalogPath = path.resolve(rootPath, versionCatalog)
  const content = fs.readFileSync(catalogPath, 'utf8')
  const versions = new Map<string, string>()
  let inVersions = false

  for (const line of content.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)]\s*$/)
    if (section) {
      inVersions = section[1] === 'versions'
      continue
    }

    if (!inVersions) {
      continue
    }

    const version = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*"([^"]+)"/)
    if (version) {
      versions.set(version[1], version[2])
    }
  }

  return versions
}

export function releaseVersion(version: string): string {
  return version.split('+')[0]
}

export function versionBranch(version: string): string {
  const match = releaseVersion(version).match(/^(\d+)\.(\d+)\./)
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`)
  }

  return `${match[1]}.${match[2]}`
}

export function isSnapshotVersion(version: string): boolean {
  return releaseVersion(version).includes('-SNAPSHOT')
}

export function compareVersions(a: string, b: string): number {
  const aParts = releaseVersion(a).split(/[.-]/)
  const bParts = releaseVersion(b).split(/[.-]/)
  const length = Math.max(aParts.length, bParts.length)

  for (let i = 0; i < length; i += 1) {
    const aPart = aParts[i] ?? '0'
    const bPart = bParts[i] ?? '0'
    const aNumber = /^\d+$/.test(aPart) ? Number(aPart) : undefined
    const bNumber = /^\d+$/.test(bPart) ? Number(bPart) : undefined

    if (aNumber !== undefined && bNumber !== undefined) {
      if (aNumber !== bNumber) {
        return aNumber - bNumber
      }
      continue
    }

    if (aPart !== bPart) {
      return aPart.localeCompare(bPart)
    }
  }

  return 0
}

export async function validateLatestVersion(
  options: ValidateLatestVersionOptions
): Promise<ValidationResult> {
  const versions = readVersionCatalog(options.rootPath, options.versionCatalog)
  const failures: string[] = []
  const dependency = options.dependency

  const configuredVersion = versions.get(dependency.versionKey)
  if (!configuredVersion) {
    if (options.rejectIfNotDeclared === false) {
      return {
        success: true,
        failures
      }
    }

    failures.push(
      `Missing ${dependency.versionKey} version in ${options.versionCatalog}`
    )

    return {
      success: false,
      failures
    }
  }

  if (options.rejectOnSnapshotVersion && isSnapshotVersion(configuredVersion)) {
    failures.push(
      `${dependency.versionKey} is a snapshot version: ${configuredVersion}`
    )

    return {
      success: false,
      failures
    }
  }

  const branch = versionBranch(configuredVersion)
  const latestVersion = await findLatestVersion(
    options,
    dependency.artifactId,
    `${branch}.*`
  )

  if (!latestVersion) {
    failures.push(
      `Could not find a Nexus release for ${dependency.artifactId} ${branch}.*`
    )

    return {
      success: false,
      failures
    }
  }

  const latestComparison = compareVersions(latestVersion, configuredVersion)
  const upToDate = latestComparison <= 0
  const result = {
    ...dependency,
    configuredVersion,
    latestVersion,
    branch,
    upToDate
  }

  if (options.rejectOnFutureVersion && latestComparison < 0) {
    failures.push(
      `${dependency.versionKey} references an unreleased version: ${configuredVersion} > ${latestVersion}`
    )
  }

  if (!upToDate) {
    failures.push(
      `${dependency.versionKey} is out of date: ${configuredVersion} < ${latestVersion}`
    )
  }

  return {
    success: failures.length === 0,
    result,
    failures
  }
}

async function findLatestVersion(
  options: ValidateLatestVersionOptions,
  artifactId: string,
  versionPattern: string
): Promise<string | undefined> {
  const versions = await searchNexus(options, artifactId, versionPattern)
  const candidates = versions
    .filter((item) => {
      if (item.repository === 'maven-releases') {
        return true
      }

      return (
        !options.rejectOnSnapshotVersion &&
        item.repository === 'maven-snapshots'
      )
    })
    .map((item) => normalizeNexusVersion(item))
    .filter((version): version is string => Boolean(version))

  candidates.sort(compareVersions).reverse()
  return candidates[0]
}

function normalizeNexusVersion(item: NexusSearchItem): string | undefined {
  if (!item.version || item.repository !== 'maven-snapshots') {
    return item.version
  }

  return item.version.replace(/-\d{8}\.\d{6}-\d+$/, '-SNAPSHOT')
}

async function searchNexus(
  options: ValidateLatestVersionOptions,
  artifactId: string,
  versionPattern: string
): Promise<NexusSearchItem[]> {
  const queryParams = new URLSearchParams({
    repository: options.repository,
    group: options.groupId,
    name: artifactId,
    version: versionPattern,
    sort: 'version'
  })

  const items: NexusSearchItem[] = []
  let continuationToken: string | null | undefined = null

  do {
    if (continuationToken) {
      queryParams.set('continuationToken', continuationToken)
    } else {
      queryParams.delete('continuationToken')
    }

    const response = await fetch(
      `${options.nexusUrl}?${queryParams.toString()}`
    )
    if (!response.ok) {
      throw new Error(
        `Nexus search failed for ${artifactId}: HTTP ${response.status}`
      )
    }

    const data = (await response.json()) as NexusSearchResult
    items.push(...(data.items ?? []))
    continuationToken = data.continuationToken
  } while (continuationToken)

  return items
}
