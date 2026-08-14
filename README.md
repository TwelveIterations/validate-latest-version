# validate-latest-version

Fails a workflow when a configured Maven dependency version is not the latest
release on its current `major.minor.*` branch.

## Usage

```yaml
- uses: TwelveIterations/validate-latest-version@v1
  with:
    versionKey: balm
    artifactId: balm-common
```

For a catalog containing `balm = "26.2.0.6"`, the action queries Nexus for
`balm-common` releases matching `26.2.*`. If Nexus has a newer release, the
action fails. By default, the action also fails if the configured version is a
future/unreleased version or contains `-SNAPSHOT`.

## Inputs

| Name                      | Default                                                     | Description                                                              |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `rootPath`                | `.`                                                         | Root path of the repository.                                             |
| `versionCatalog`          | `gradle/libs.versions.toml`                                 | Path to the Gradle version catalog, relative to `rootPath`.              |
| `nexusUrl`                | `https://maven.twelveiterations.com/service/rest/v1/search` | Nexus search API URL.                                                    |
| `repository`              | `maven-public`                                              | Nexus repository to search.                                              |
| `groupId`                 | `net.blay09.mods`                                           | Maven group id to search.                                                |
| `versionKey`              | Required                                                    | Version catalog key to check.                                            |
| `artifactId`              | Required                                                    | Maven artifact id to search.                                             |
| `rejectOnFutureVersion`   | `true`                                                      | Fail when the configured version is newer than the latest Maven release. |
| `rejectOnSnapshotVersion` | `true`                                                      | Fail when the configured version contains `-SNAPSHOT`.                   |

## Custom Dependencies

Run the action once per dependency:

```yaml
- uses: TwelveIterations/validate-latest-version@v1
  with:
    versionKey: balm
    artifactId: balm-common

- uses: TwelveIterations/validate-latest-version@v1
  with:
    versionKey: shogi
    artifactId: shogi-common
```

## Outputs

| Name      | Description                                |
| --------- | ------------------------------------------ |
| `success` | Whether the configured version is current. |
| `result`  | JSON checked dependency version result.    |

## Development

```bash
npm install
npm test
npm run bundle
```
